import * as fs from "fs";
import * as path from "path";
import { execFile, spawn } from "child_process";
import { Grammar } from "./Grammar";
import { ErrorManager, PawnError } from "./ErrorManager";
import { ParserManager } from "./ParserManager";
import { getConnection, isHaveConfigurationCapability, globalSettings } from "./server";
import { Connection } from 'vscode-languageserver';

enum eParsingList
{
	FILE,
	ENUMERATOR,
	CONSTANT_EXPRESSION,
	VARIABLE,
	FUNCTION,
	SUBSTITUTION,
	TAG
}

/*export const keywords: string[] = [
	"*=", "/=", "%=", "+=", "-=", "<<=", ">>>=", ">>=", "&=", "^=", "|=",
	"||", "&&", "==", "!=", "<=", ">=", "<<", ">>>", ">>", "++", "--",
	"...", "..", "::",
	"assert", "*begin", "break", "case", "char", "const", "continue", "default",
	"defined", "do", "else", "emit", "__emit", "*end", "enum", "exit", "for",
	"forward", "goto", "if", "native", "new", "operator", "public", "return",
	"sizeof", "sleep", "state", "static", "stock", "switch", "tagof", "*then",
	"while",
	"#assert", "#define", "#else", "#elseif", "#emit", "#endif", "#endinput",
	"#endscript", "#error", "#file", "#if", "#include", "#line", "#pragma",
	"#tryinclude", "#undef", "#warning",
	";", ";", "-integer value-", "-rational value-", "-identifier-",
	"-label-", "-string-",
	"-any value-", "-numeric value-", "-data offset-", "-local variable-",
	"-function-", "-native function-", "-nonnegative integer-"
];*/
/*export const keywords: string[] = [
	"new",
	"function",
	"public",
	"stock",
	"static",
	"const",
	"if",
	"else",
	"enum",
	"switch",
	"case",
	"default",
	"return",
	"continue",
	"break",
	"char",
	"goto",
	"for",
	"do",
	"while",
	"state"
];*/

interface ParserResult {
	type: string;
	contents: any;
}

export class Parser
{
	private mainPath: string;
	private mainFile: string = "";
	grammar: Grammar;
	errorManager: ErrorManager;
	private stdoutBuffer: string;
	private parserProgressCount: number;
	private iAmWorkspaceParser: boolean;

	constructor(mainPath: string, isWorkspaceParser: boolean = false) {
		this.mainPath = mainPath;
		this.grammar = new Grammar();
		this.errorManager = new ErrorManager();
		this.stdoutBuffer = " ";
		this.parserProgressCount = 0;
		this.iAmWorkspaceParser = isWorkspaceParser;

		/*if (isWorkspaceParser && this.mainPath[this.mainPath.length - 1] != path.sep) { // -i include option require path seperator at path end
			this.mainPath += path.sep;
		}*/
	}

	async run(): Promise<void> {
		const connection: Connection = getConnection();

		if (!isHaveConfigurationCapability() || this.isInProgress()) {
			return;
		}

		if (this.iAmWorkspaceParser && (this.mainFile === undefined || !this.mainFile.length)) {
			return;
		}

		let args: string[] = [ (this.iAmWorkspaceParser) ? path.join(this.mainPath, this.mainFile) : this.mainPath ];

		if (globalSettings.compilerPath != globalSettings.parserPath) {
			args.push("-i" + path.join(globalSettings.compilerPath, "include") + path.sep);
		}
		
		args = args.concat(globalSettings.compileOptions!);

		/*if (this.iAmWorkspaceParser) {
			args.push("-i" + this.mainPath + path.sep);
		}*/

		++this.parserProgressCount;

		const parser = spawn(path.join(globalSettings.parserPath, "pawnparser.exe"), args, { cwd: path.dirname(this.mainPath) });

		parser.on("error", (err: Error) => {
			if (--this.parserProgressCount < 0) {
				this.parserProgressCount = 0;
			}

			connection.console.log("Parser spawn ERROR!");
			connection.console.log(err.message);
		});

		parser.stderr.on("data", (chunk: string | Buffer) => {
			connection.console.log(chunk.toString());
		});

		parser.stdout.on("data", (chunk: string | Buffer) => {
			let data: string = chunk.toString().replace(/[\r]/g, '');
			
			this.stdoutBuffer += data;
		});

		parser.on("exit", () => {
			let splitedData: string[] = this.stdoutBuffer.split('\n');

			this.errorManager.clear();

			splitedData.forEach((value: string) => {
				if (value.length > 0) {
					let result: ParserResult | undefined = undefined;

					try {
						result = JSON.parse(value.replace(/\bInfinity\b/g, "0.0"));
					} catch (e) {
						connection.console.log("Parsing data ERROR!");
						connection.console.log(e.message);
					}

					if (result !== undefined) {
						if (result.type == "error") {
							this.errorManager.addError(result.contents);
						} else if (result.type == "files") {
							this.grammar.addFiles(result.contents);
						} else if (result.type == "constants") {
							this.grammar.addConstantExpressions(result.contents);
						} else if (result.type == "tags") {
							this.grammar.addTags(result.contents);
						} else if (result.type == "enumerators") {
							this.grammar.addEnumerators(result.contents);
						} else if (result.type == "variables") {
							this.grammar.addVariables(result.contents);
						} else if (result.type == "functions") {
							this.grammar.addFunctions(result.contents);
						} else if (result.type == "substitutes") {
							this.grammar.addSubstitutes(result.contents);
						}
					}
				}
			});
			/*this.grammar.functions.forEach((value) => {
				connection.console.log(value.detail);
			});*/

			this.grammar.makeDetailAll();

			connection.console.log("");
			this.errorManager.errors.forEach((error: PawnError) => {
				connection.console.log(error.error_detail);
			});

			this.stdoutBuffer = "";

			if (--this.parserProgressCount < 0) {
				this.parserProgressCount = 0;
			}

			connection.console.log("Path \"" + this.mainPath + "\" Parsing end.");

			if (this.isWorkspaceParser()) {
				ParserManager.updateGarbageCollect(this);
			}
		});
	}

	setMainFile(file: string, reparse: boolean = true): void {
		if (!this.iAmWorkspaceParser) {
			return;
		}

		this.mainFile = file;

		if (reparse) {
			this.grammar.clear();
			this.run();
		}
	}

	getPath(): string {
		return this.mainPath;
	}

	getMainFile(): string | undefined {
		return this.mainFile;
	}

	isInProgress(): boolean {
		return (this.parserProgressCount > 0);
	}

	isWorkspaceParser(): boolean {
		return this.iAmWorkspaceParser;
	}
}
