import { window, commands, workspace, Selection, TextEditorRevealType, env, Range } from 'vscode'
import { Global, Commands, LocaleRecord, KeyDetector, decorateLocale } from '../core'
import { ExtensionModule } from '../modules'
import { LocaleTreeItem, Node } from '../views/LocalesTreeView'
import * as path from 'path'
import { flatten } from 'lodash'
import i18n from '../i18n'

async function getRecordFromNode (node: Node, defaultLocale?: string) {
  if (node.type === 'tree')
    return

  if (node.type === 'record')
    return node

  if (node.type === 'node') {
    const locales = Global.loader.getShadowLocales(node)
    const locale = defaultLocale || await window.showQuickPick(
      Global.visibleLocales,
      { placeHolder: i18n.t('prompt.choice_locale') }
    )
    if (!locale)
      return
    return locales[locale]
  }
}

const m: ExtensionModule = (ctx) => {
  return [
    commands.registerCommand(Commands.copy_key,
      async ({ node }: LocaleTreeItem) => {
        // @ts-ignore
        await env.clipboard.writeText(`$t('${node.keypath}')`)
        window.showInformationMessage(i18n.t('prompt.key_copied'))
      }),

    commands.registerCommand(Commands.translate_key,
      async (item?: LocaleTreeItem) => {
        if (!item || !item.node)
          return

        if (item.node.type === 'tree')
          return

        try {
          const pendings = await Global.loader.MachineTranslate(item.node)
          if (pendings.length) {
            await Global.loader.writeToFile(pendings)
            window.showInformationMessage(i18n.t('prompt.translation_saved'))
          }
        }
        catch (err) {
          window.showErrorMessage(err.toString())
        }
      }),

    commands.registerCommand(Commands.open_key,
      async (item?: LocaleTreeItem) => {
        if (!item || !item.node)
          return

        const node = await getRecordFromNode(item.node, Global.displayLanguage)

        if (!node || !node.filepath)
          return

        const filepath = node.filepath
        const keypath = item.node.keypath

        const document = await workspace.openTextDocument(filepath)
        const editor = await window.showTextDocument(document)

        const ext = path.extname(filepath)
        const parser = Global.getMatchedParser(ext)
        if (!parser)
          return

        const text = editor.document.getText()
        const range = parser.navigateToKey(text, keypath)

        if (range) {
          editor.selection = new Selection(
            document.positionAt(range.end),
            document.positionAt(range.start)
          )
          editor.revealRange(editor.selection, TextEditorRevealType.InCenter)
          commands.executeCommand('workbench.action.focusActiveEditorGroup')
        }
        else {
          window.showWarningMessage(i18n.t('prompt.failed_to_locale_key', keypath))
        }
      }),

    commands.registerCommand(Commands.edit_key,
      async (item?: LocaleTreeItem | { keypath: string; locale: string }) => {
        if (!item)
          return

        let node = item instanceof LocaleTreeItem ? item.node : Global.loader.getRecordByKey(item.keypath, item.locale)

        if (!node)
          return

        if (node.type === 'tree')
          return

        if (node.type === 'node') {
          const record = await getRecordFromNode(node, Global.displayLanguage)
          if (!record)
            return
          node = record
        }

        try {
          const newvalue = await window.showInputBox({
            value: node.value,
            prompt: i18n.t('prompt.edit_key_in_locale', node.keypath, decorateLocale(node.locale)),
          })

          if (newvalue !== undefined && newvalue !== node.value) {
            await Global.loader.writeToFile({
              value: newvalue,
              keypath: node.keypath,
              filepath: node.filepath,
              locale: node.locale,
            })
          }
        }
        catch (err) {
          window.showErrorMessage(err.toString())
        }
      }),

    commands.registerCommand(Commands.rename_key,
      async (item?: LocaleTreeItem | string) => {
        if (!item)
          return

        let node: Node | undefined

        if (typeof item === 'string')
          node = Global.loader.getTreeNodeByKey(item)
        else
          node = item.node

        if (!node)
          return

        let records: LocaleRecord[] = []

        if (node.type === 'tree')
          return

        else if (node.type === 'record')
          records = [node]

        else
          records = Object.values(node.locales)

        try {
          const oldkeypath = node.keypath
          const newkeypath = await window.showInputBox({
            value: oldkeypath,
            prompt: i18n.t('prompt.enter_new_keypath'),
          })

          if (!newkeypath || newkeypath === node.keypath)
            return

          // save to locale files
          const writes = flatten(records
            .filter(record => !record.shadow)
            .map(record => [{
              value: undefined,
              keypath: oldkeypath,
              filepath: record.filepath,
              locale: record.locale,
            }, {
              value: record.value,
              keypath: newkeypath,
              filepath: record.filepath,
              locale: record.locale,
            }]))

          if (!writes.length)
            return

          await Global.loader.writeToFile(writes)

          // update current file
          const editor = window.activeTextEditor
          if (!editor)
            return
          const document = editor.document
          if (!document)
            return

          const keys = KeyDetector
            .getKeys(document)
            .filter(({ key }) => key === oldkeypath)

          editor.edit((builder) => {
            keys.forEach(({ start, end }) => {
              builder.replace(new Range(
                document.positionAt(start),
                document.positionAt(end),
              ), newkeypath)
            })
          })
        }
        catch (err) {
          window.showErrorMessage(err.toString())
        }
      }),

    commands.registerCommand(Commands.delete_key,
      async ({ node }: LocaleTreeItem) => {
        let records: LocaleRecord[] = []

        if (node.type === 'tree')
          return

        else if (node.type === 'record')
          records = [node]

        else
          records = Object.values(node.locales)

        try {
          await Global.loader.writeToFile(records
            .filter(record => !record.shadow)
            .map(record => ({
              value: undefined,
              keypath: record.keypath,
              filepath: record.filepath,
              locale: record.locale,
            })))
        }
        catch (err) {
          window.showErrorMessage(err.toString())
        }
      }),
  ]
}

export default m
