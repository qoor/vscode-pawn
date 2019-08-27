import * as path from "path";
import * as fs from "fs";
import {
	createConnection,
	ProposedFeatures,
	TextDocuments,
	InitializeParams,
	CompletionParams,
	CompletionItem,
	TextDocumentChangeEvent,
	DidChangeWatchedFilesParams,
	WorkspaceFoldersChangeEvent,
	Connection,
	Position,
	Range,
	CompletionItemKind,
	TextDocumentPositionParams,
	CancellationToken,
	SignatureHelp,
	TextDocument,
	Hover,
	DidChangeConfigurationParams,
	MarkupContent,
	MarkupKind
} from "vscode-languageserver";
import { Parser } from "./Parser";
import { uriToFilePath } from 'vscode-languageserver/lib/files';
import { PawnFunction, PawnSubstitute, Grammar, PawnSymbol, PawnEnumeratorField } from "./Grammar";
import { ParserManager } from "./ParserManager";

let connection: Connection = createConnection(ProposedFeatures.all);
let documents: TextDocuments = new TextDocuments();

export const SYMBOL_NAME_REGEX = /[a-zA-Z0-9_@]/;

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

interface PawnSettings {
	compilerPath: string;
	compileOptions: string[];
	parserPath: string;
}

export let globalSettings: PawnSettings;

connection.onInitialize((params: InitializeParams) => {
	let capabilities = params.capabilities;
	//const workspaceRoot: string = path.normalize(uriToFilePath(params.rootUri!)!);
	let mainFile: string | undefined;

	ParserManager.connection = connection;

	hasConfigurationCapability =
		capabilities.workspace! && !!capabilities.workspace!.configuration;
	hasWorkspaceFolderCapability =
		capabilities.workspace! && !!capabilities.workspace!.workspaceFolders;
	hasDiagnosticRelatedInformationCapability =
		capabilities.textDocument! &&
		capabilities.textDocument!.publishDiagnostics! &&
		capabilities.textDocument!.publishDiagnostics!.relatedInformation!;

	if (params.initializationOptions) {
		globalSettings = <PawnSettings>(params.initializationOptions);
	} else {
		globalSettings.compileOptions = [ "-d1", "-O1", "-(", "-;" ];
	}

	if (hasWorkspaceFolderCapability && params.workspaceFolders !== null) {
		ParserManager.createWorkspacesParser(params.workspaceFolders);
	}

	/*if (workspaceRoot.length > 0) {
		ParserManager.workspaceRoot = workspaceRoot!;
		//connection.console.log("Workspace path: " + ParserManager.workspaceRoot);

		if (!mainFile) {
			mainFile = getWorkspaceDefaultMainFile(workspaceRoot);
		}

		const parser: Parser = ParserManager.getParser(path.join(ParserManager.workspaceRoot, mainFile))!;

		parser.setMainFile(mainFile!);

		//parser.run();
	}*/

	connection.console.log("PAWN Language server initialized.");

	return {
		capabilities: {
			textDocumentSync: documents.syncKind,

			completionProvider: {
				resolveProvider: true
			},
			signatureHelpProvider: {
				triggerCharacters: [ '(', ',' ]
			},
			hoverProvider: true
		}
	};
});

// Not tested.
connection.onInitialized(() => {
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders((e: WorkspaceFoldersChangeEvent) => {
			connection.console.log("Workspace folder change event received.");

			ParserManager.updateWorkspacesParser(e.removed, e.added);
		});
	}
});

connection.onDidChangeConfiguration((params: DidChangeConfigurationParams) => {
	globalSettings = <PawnSettings>(params.settings.pawn);

	for (let i of ParserManager.getParsersValues()) {
		i.run();
	}
});

connection.onRequest("compile_request", (param: string) => {
	connection.console.log("Received compile request. param: " + param);

	compile(param);
});

connection.onRequest((method: string, ...params: any[]) => {
	if (method == "compile_request") {
		connection.console.log("Received compile request. params: " + params[0].document);
		//connection.sendRequest("compile", globalSettings);
	}
});

/*connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams): void => {
	let document = uriToFilePath(params.textDocument.uri)!;

	connection.console.log(document + " has opened.");

	if (!workspaceRoot) {
		parser.run(document);
	}
});

connection.onDidSaveTextDocument((params: DidSaveTextDocumentParams): void => {
	let document = uriToFilePath(params.textDocument.uri)!;

	connection.console.log(document + " has saved.");

	if (!workspaceRoot || (workspaceRoot && path.normalize(path.dirname(document)) === workspaceRoot)) {
		parser.run(document);
	}
});

connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams): void => {
	let document = uriToFilePath(params.textDocument.uri)!;

	connection.console.log(document + " has closed.");
});*/

documents.onDidOpen((e: TextDocumentChangeEvent) => {
	const documentPath = uriToFilePath(e.document.uri)!;

	connection.console.log(documentPath + " has opened.");

	const parser: Parser | undefined = ParserManager.getParser(documentPath);
	
	if (parser !== undefined && !parser.isWorkspaceParser()) {
		parser.run();
	}
});

documents.onDidSave((e: TextDocumentChangeEvent) => {
	const documentPath = uriToFilePath(e.document.uri)!;

	connection.console.log(documentPath + " has saved.");

	const parser: Parser | undefined = ParserManager.getParser(documentPath);

	if (parser !== undefined) {
		parser.run().then(() => {
			if (parser.isWorkspaceParser()) {
				ParserManager.updateGarbageCollect(parser);
			}
		});
	}
});

documents.onDidChangeContent((e: TextDocumentChangeEvent) => {
	/*const documentPath = uriToFilePath(e.document.uri)!;
	const parser: Parser | undefined = ParserManager.getParser(documentPath);

	if (parser === undefined) {
		return;
	}

	const diagnostics: Diagnostic[] = parser.errorManager.getDiagnostics(e.document!);

	if (diagnostics.length > 0) {
		connection.sendDiagnostics({ uri: e.document.uri, diagnostics });
	}*/ /* It is require pawnparser project refactoring */
});

documents.onDidClose(e => {
	const documentPath = uriToFilePath(e.document.uri)!;

	connection.console.log(documentPath + " has closed.");

	const parser: Parser | undefined = ParserManager.getParser(documentPath, false);

	if (parser !== undefined && !parser.isWorkspaceParser()) {
		ParserManager.removeParser(documentPath);
	}
});

connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
	connection.console.log("We received an file change event");
});

connection.onCompletion((params: CompletionParams): CompletionItem[] => {
	const document = documents.get(params.textDocument!.uri)!;
	const documentPath: string = uriToFilePath(params.textDocument!.uri)!;
	const parser: Parser | undefined = ParserManager.getParser(documentPath);

	if (parser === undefined) {
		return [];
	}

	const grammar: Grammar = parser.grammar;
	const fileNumber: number = grammar.getFileNumber(documentPath);
	
	if (isPositionInString(document, params.position) || isPositionInComment(document, params.position)) {
		//connection.console.log("You are in string or comment.");
		return [];
	}

	let completionItemList: CompletionItem[];
	
	completionItemList = (grammar.enumerators.map((en) => {
		return {
			label: en.name,
			kind: CompletionItemKind.Enum,
			detail: en.detail
		};
	}));

	completionItemList = completionItemList.concat(grammar.substitutions.filter((sym) => { return grammar.symbolFinder(sym, "", fileNumber); })!.map((en) => {
		return {
			label: en.pattern.substr(0, en.match_length),
			kind: CompletionItemKind.Keyword,
			detail: en.detail
		};
	}));

	completionItemList = completionItemList.concat(grammar.tags.filter((sym) => { return grammar.symbolFinder(sym, "", fileNumber); })!.map((en) => {
		return {
			label: en.name + ':',
			kind: CompletionItemKind.Class,
			detail: en.detail
		};
	}));

	completionItemList = completionItemList.concat(grammar.constantExpressions.filter((sym) => { return grammar.symbolFinder(sym, "", fileNumber); })!.map((en) => {
		return {
			label: en.name,
			kind: CompletionItemKind.Constant,
			detail: en.detail
		};
	}));

	completionItemList = completionItemList.concat(grammar.variables.filter((sym) => { return grammar.symbolFinder(sym, "", fileNumber); })!.map((en) => {
		return {
			label: en.name,
			kind: CompletionItemKind.Variable,
			detail: en.detail
		};
	}));

	completionItemList = completionItemList.concat(grammar.functions.filter((sym) => { return grammar.symbolFinder(sym, "", fileNumber); })!.map((en) => {
		return {
			label: en.name,
			kind: CompletionItemKind.Function,
			detail: en.detail
		};
	}));

	return completionItemList;
});

connection.onSignatureHelp((params: TextDocumentPositionParams, token: CancellationToken): SignatureHelp | null => {
	const document = documents.get(params.textDocument.uri)!;
	const documentPath: string = uriToFilePath(params.textDocument!.uri)!;
	const parser: Parser | undefined = ParserManager.getParser(documentPath);

	if (parser === undefined) {
		return null;
	}

	const grammar: Grammar = parser.grammar;
	const fileNumber: number = grammar.getFileNumber(documentPath);
	
	if (isPositionInComment(document, params.position)) {
		//connection.console.log("You are in comment.");
		return null;
	}

	if (isPositionInString(document, params.position)) {
		//connection.console.log("You are in string");
		return null;
	}

	const theCall = walkBackwardsToBeginningOfCall(document, params.position);

	if (theCall === undefined) {
		//connection.console.log("Beginning of call cannot found.");
		//connection.console.log("Information:\n" + JSON.stringify(theCall));
		return null;
	}

	const callToken: { start: number, token: string } | undefined = previousToken(document, theCall.openParen);

	if (callToken === undefined) {
		//connection.console.log("Call token cannot found.");
		return null;
	}

	let symbol: PawnSubstitute | PawnFunction | undefined =
		grammar.substitutions.find((element) => { return (element.pattern.substring(0, element.match_length) == callToken.token); });

	if (!symbol) {
		//connection.console.log("Substitute " + callToken.token + " cannot found. Try find to function..");
		symbol = grammar.functions.find((element) => { return grammar.symbolFinder(element, callToken.token, fileNumber); });

		if (!symbol) {
			//connection.console.log(callToken.token + " cannot found.");
			return null;
		}
	}

	//connection.console.log(callToken.token + " found success!");

	if (Grammar.isFunction(symbol as PawnSymbol)) {
		return {
			signatures: [{
				label: symbol.detail,
				parameters: (symbol as PawnFunction).argument.map((arg) => {
					return { label: arg.detail };
				})
			}],
			activeSignature: 0,
			activeParameter: Math.min(theCall.commas.length, (symbol as PawnFunction).argument.length - 1)
		};
	}

	return {
		signatures: [{
			label: symbol.detail,
			parameters: []
		}],
		activeSignature: 0,
		activeParameter: 0
	};
});

connection.onHover((params: TextDocumentPositionParams, token: CancellationToken): Hover | null => {
	const document = documents.get(params.textDocument.uri)!;
	const documentPath: string = uriToFilePath(params.textDocument!.uri)!;
	const parser: Parser | undefined = ParserManager.getParser(documentPath);

	if (parser === undefined) {
		return null;
	}

	const grammar: Grammar = parser.grammar;
	const fileNumber: number = grammar.getFileNumber(documentPath);

	if (isPositionInString(document, params.position) || isPositionInComment(document, params.position)) {
		//connection.console.log("You are in string or comment.");
		return null;
	}

	const callToken: { start: number, token: string } | undefined = previousToken(document, params.position);

	if (callToken === undefined) {
		return null;
	}

	let symbol;
	
	if (!(symbol = grammar.substitutions.find((sym) => { return grammar.symbolFinder(sym, callToken.token, fileNumber, callToken.token.length); }))) {
		if (!(symbol = grammar.tags.find((sym) => { return grammar.symbolFinder(sym, callToken.token, fileNumber); }))) {
			if (!(symbol = grammar.constantExpressions.find((sym) => { return grammar.symbolFinder(sym, callToken.token, fileNumber); }))) {
				if (!(symbol = grammar.enumerators.find((sym) => { return grammar.symbolFinder(sym, callToken.token, fileNumber); }))) {
					if (!(symbol = grammar.variables.find((sym) => { return grammar.symbolFinder(sym, callToken.token, fileNumber); }))) {
						if (!(symbol = grammar.functions.find((sym) => { return grammar.symbolFinder(sym, callToken.token, fileNumber); }))) {
							//connection.console.log("Symbol " + callToken.token + " cannot found.");
							return null;
						}
					}
				}
			}
		}
	}

	let markupContent: MarkupContent = {
		kind: MarkupKind.Markdown,
		value: "\`\`\`pawn\n" + symbol.detail + "\n\`\`\`"
	};

	if (Grammar.isEnumeratorField(symbol as PawnSymbol)) {
		const field: PawnEnumeratorField = symbol as PawnEnumeratorField;

		markupContent.value = "\`\`\`pawn\n" + field.parent.detail.substring(0, field.parent.detail.indexOf("{\n")) + "{\n\t...,\n\t" + field.detail + ",\n\t...\n}\n\`\`\`";
	}
	else if (Grammar.isSubstitute(symbol)) {
		const attachString: string = grammar.makeSubstituteHoverString(document, callToken.start);

		if (attachString.length > 0) {
			markupContent.value += "\n***\nReplaced to:\n\`\`\`pawn\n" + attachString + "\n\`\`\`";
		}
	}

	return {
		contents: markupContent
	};
});

documents.listen(connection);
connection.listen();

function isPositionInComment(document: TextDocument, position: Position): boolean {
	let lineText = document.getText(Range.create(position.line, 0, position.line, position.character));
	let commentIndex = lineText.indexOf("//");

	if (commentIndex >= 0 && position.character > commentIndex) {
		let commentPosition = Position.create(position.line, commentIndex);
		let isCommentInString = isPositionInString(document, commentPosition);

		return !isCommentInString;
	}

	//let previousText = document.getText(Range.create(-1, -1, position.line, position.character));
	//let blockCommentOpenCount = (previousText.match(/\/\*/g) || []).length;
	//let blockCommentCloseCount = (previousText.match(/\*\//g) || []).length;

	//let blockCommentIndex;
	
	//while ((blockCommentIndex = previousText.indexOf("/*", blockCommentIndex)) >= 0) {
		//++blockCommentCount;

		//if ((blockCommentCount = previousText.indexOf("*/", blockCommentIndex)) >= 0) {
			//--blockCommentCount;
		//}
	//}

	//if (blockCommentCount > 0) {
		//return true;
	//}

	//blockCommentOpenCount -= blockCommentCloseCount;

	//return (blockCommentOpenCount == 0);
	return false;
}

function isPositionInString(document: TextDocument, position: Position): boolean {
	let previousText = document.getText(Range.create(position.line, 0, position.line, position.character));
	let doubleQuotesCount = (previousText.match(/\"/g) || []).length;
	let escapedDoubleQuotesCount = (previousText.match(/\\\"/g) || []).length;

	doubleQuotesCount -= escapedDoubleQuotesCount;

	return ((doubleQuotesCount % 2) == 1);
}

function walkBackwardsToBeginningOfCall(document: TextDocument, position: Position): { openParen: Position, commas: Position[] } | undefined {
	let parenBalance = 0;
	let bracketBalance = 0;
	let maxLookupLines = 30;
	const commas: Position[] = [];
	let lineText: string = "";
	let char;

	for (let lineNumber = position.line; lineNumber >= 0 && maxLookupLines >= 0; --lineNumber, --maxLookupLines) {
		if (isPositionInComment(document, position)) {
			return undefined;
		}

		const [ currentLine, characterPosition ] = (lineNumber === position.line) ?
			[ document.getText(Range.create(lineNumber, 0, lineNumber, position.character)), position.character ] :
			[ (lineText = document.getText(Range.create(lineNumber, 0, lineNumber, Number.MAX_VALUE))), lineText.length ];
		
		for (char = characterPosition; char >= 0; --char) {
			switch (currentLine[char]) {
				case '{':
				{
					++bracketBalance;
					break;
				}
				case '}':
				{
					--bracketBalance;
					break;
				}

				case '(':
				{
					if ((--parenBalance) < 0) {
						return {
							openParen: Position.create(lineNumber, char),
							commas
						};
					}

					break;
				}
				case ')':
				{
					++parenBalance;
					break;
				}

				case ',':
				{
					const commaPos = Position.create(lineNumber, char);

					if (parenBalance === 0 && bracketBalance === 0 && !isPositionInString(document, commaPos)) {
						commas.push(commaPos);
					}

					break;
				}
			}
		}
	}

	return undefined;
}

function previousToken(document: TextDocument, position: Position): { start: number, token: string } | undefined {
	while (position.character > 0) {
		const word = getWordRangeAtPosition(document, position);

		if (word) {
			return word;
		}

		--position.character;
	}

	return undefined;
}

function getWordRangeAtPosition(document: TextDocument, position: Position): { start: number, token: string } | undefined {
	let text: string = document.getText();
	let maxOffset: number = document.offsetAt(position);
	let startWord: number = maxOffset - 1;
	let lastWord: number = maxOffset;

	while (startWord >= 0 && SYMBOL_NAME_REGEX.test(text[startWord])) {
		--startWord;
	}
	while (lastWord < text.length && SYMBOL_NAME_REGEX.test(text[lastWord])) {
		++lastWord;
	}

	++startWord;

	if (startWord > lastWord - 1) {
		return undefined;
	}

	return {
		start: startWord,
		token: text.substr(startWord, lastWord - startWord)
	};
}

export function getConnection() {
	return connection;
}

function compile(uri: string): void {
	const filePath: string = uriToFilePath(uri)!;
	let parser: Parser | undefined = ParserManager.getParser(filePath);

	if (parser === undefined) {
		return;
	}

	const currentFile: string = (parser.isWorkspaceParser()) ? path.join(parser.getPath(), parser.getMainFile()!) : filePath;

	if (!currentFile.length) {
		return;
	}

	let args: string[] = [ currentFile ];

	args = args.concat(globalSettings.compileOptions!);

	if (globalSettings.compilerPath != globalSettings.parserPath) {
		args.push("-i" + path.join(globalSettings.compilerPath, "include") + path.sep);
	}
	if (parser.isWorkspaceParser()) {
		args.push("-i" + filePath);
	}

	connection.sendRequest("compile", { args: args });
}

export function isHaveWorkspaceFolderCapability() {
	return hasWorkspaceFolderCapability;
}

export function isHaveConfigurationCapability() {
	return hasConfigurationCapability;
}
