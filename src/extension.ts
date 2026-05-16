import * as vscode from 'vscode'

const makeTokenName = () => 'SOME_TOKEN_' + Date.now()

class DataBlock {
	public data: { token: string, secret: string }[]
	public dataRangeEndLine = 0

	private static dataBlockPrefix = '## ninya data'
	private static dataBlockStart = DataBlock.dataBlockPrefix
	private static dataBlockEnd = DataBlock.dataBlockPrefix + ' end'

	private static dataLineRegexp = /^([^=]+)=(.*)$/

	constructor(
		private editor: vscode.TextEditor
	) {
		this.data = []

		const doc = editor.document

		// если в начале файла нет нужной строки, то парсить нечего
		if (doc.lineAt(0).text !== DataBlock.dataBlockStart) {
			return
		}

		// спарсить блок данных
		let success = false
		for (let i = 1; i < doc.lineCount; i++) {
			this.dataRangeEndLine = i

			const line = doc.lineAt(i)

			if (line.text === DataBlock.dataBlockEnd) {
				success = true
				break
			}

			const matchRes = line.text.match(DataBlock.dataLineRegexp)
			if (matchRes === null) {
				throw new Error(`cant match line of data block, check syntax: "${line}"`)
			}

			const [_, token, secret] = matchRes

			this.data.push({token, secret})
		}

		if (!success) {
			throw new Error('cant find data block end')
		}
	}

	public save(editBuilder: vscode.TextEditorEdit) {
		let endChar = DataBlock.dataBlockEnd.length
		let dataStr = this.dumpData()

		if (this.dataRangeEndLine === 0) {
			endChar = 0
			dataStr += '\n\n'
		}

		editBuilder.replace(
			new vscode.Range(
				new vscode.Position(0, 0),
				// если блока данных не было и эта строка пустая, то vscode сам уменьшит character до 0
				new vscode.Position(this.dataRangeEndLine, endChar),
			),
			dataStr,
		)
	}

	// добавляет новую пару токен-секрет и возвращает selection, куда она будет вставлена при сохранении
	public add(token: string, secret: string) {
		const i = this.data.push({token, secret}) - 1
		const line = i + 1

		return new vscode.Selection(
			new vscode.Position(line, 0),
			new vscode.Position(line, token.length),
		)
	}

	// возвращает блок данных с текущими данными в виде строки
	private dumpData() {
		return [
			DataBlock.dataBlockStart,
			...this.data.map(v => `${v.token}=${v.secret}`),
			DataBlock.dataBlockEnd,
		].join('\n')
	}

	public isInside(line: number) {
		return line <= this.dataRangeEndLine
	}

	public removeDataBlock(editBuilder: vscode.TextEditorEdit) {
		editBuilder.delete(new vscode.Range(
			new vscode.Position(0, 0),
			new vscode.Position(this.dataRangeEndLine, DataBlock.dataBlockEnd.length),
		))
	}
}

export function activate(context: vscode.ExtensionContext) {
	const disposable1 = vscode.commands.registerCommand('ninya.createTokenFromSelections', function() {
		try {
			const editor = vscode.window.activeTextEditor

			if (!editor) {
				throw new Error('there is no active editor')
			}

			let newTokenSel: vscode.Selection
			editor.edit(editBuilder => {
				const token = makeTokenName()
				const secret = editor.document.getText(editor.selection)
				
				// заменить все вхождения секрета на токен
				editor.selections.forEach(sel => editBuilder.replace(sel, token))

				// добавить пару в датаблок
				const db = new DataBlock(editor)
				newTokenSel = db.add(token, secret)

				// записать датаблок
				db.save(editBuilder)
			}).then((success) => {
				if (!success) {
					return
				}

				// добавить созданный токен к списку выделений
				editor.selections = [...editor.selections, newTokenSel]
			})

		} catch (error) {
			vscode.window.showErrorMessage(mustMakeError(error).message)
		}
	})

	const disposable2 = vscode.commands.registerCommand('ninya.recover', function() {
		try {
			const editor = vscode.window.activeTextEditor

			if (!editor) {
				throw new Error('there is no active editor')
			}

			editor.edit(editBuilder => {
				const db = new DataBlock(editor)
				for (let i = db.dataRangeEndLine + 1; i < editor.document.lineCount; i++) {
					const line = editor.document.lineAt(i)

					for (const item of db.data) {
						let pos = 0
						while (true) {
							const res = line.text.indexOf(item.token, pos)
	
							if (res === -1) {
								break
							}
	
							const nextPos = res+item.token.length
							editBuilder.replace(
								new vscode.Range(
									new vscode.Position(i, res),
									new vscode.Position(i, nextPos),
								),
								item.secret,
							)
	
							pos = nextPos
						}
					}
				}

				db.removeDataBlock(editBuilder)
			})
		} catch (error) {
			vscode.window.showErrorMessage(mustMakeError(error).message)
		}
	})

	context.subscriptions.push(disposable1, disposable2)
}

const mustMakeError = (error: unknown) => {
	if (error instanceof Error) {
		return error
	}

	if (typeof error === 'string') {
		return new Error(error)
	}

	throw new SyntaxError('got neither an error or a string')
}