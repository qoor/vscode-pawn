import * as path from "path";
import * as fs from "fs";
import { Connection, WorkspaceFolder } from 'vscode-languageserver';
import { isHaveWorkspaceFolderCapability } from './server';
import { Parser } from "./Parser";
import { PawnFile } from './Grammar';
import * as assert from 'assert';
import { uriToFilePath } from 'vscode-languageserver/lib/files';

export class ParserManager {
	static connection: Connection;
	private static parsers: Map<string, Parser> = new Map();
	private static workspaces: Map<string, WorkspaceFolder> = new Map();
	private static workspacesParserInitalized: boolean = false;

	// ParserManager should create workspaces parser //
	// Because if parser not found while getParser() call, getParser() create parser automatly every file path. //
	static createWorkspacesParser(workspaces: WorkspaceFolder[]) {
		assert(workspaces !== null);

		workspaces.forEach((workspace: WorkspaceFolder) => {
			const key: string = uriToFilePath(workspace.uri)!;
			const workspaceParser: Parser = new Parser(key, true);
			
			ParserManager.parsers.set(key, workspaceParser);
			workspaceParser.setMainFile(ParserManager.getWorkspaceDefaultMainFile(key)); // Automatly parser run

			ParserManager.workspaces.set(key, workspace);
		});

		ParserManager.workspacesParserInitalized = true;
	}
	// //

	static updateWorkspacesParser(removed: WorkspaceFolder[], added: WorkspaceFolder[]) {
		removed.forEach((value: WorkspaceFolder) => {
			const key: string = uriToFilePath(value.uri)!;

			ParserManager.parsers.delete(key);
			ParserManager.workspaces.delete(value.uri);

		});
		added.forEach((value: WorkspaceFolder) => {
			const key: string = uriToFilePath(value.uri)!;
			const workspaceParser: Parser = new Parser(key, true);

			ParserManager.parsers.set(key, workspaceParser);
			workspaceParser.setMainFile(ParserManager.getWorkspaceDefaultMainFile(key)); // Automatly parser run

			ParserManager.workspaces.set(value.uri, value);
		});
	}

	private static getWorkspaceDefaultMainFile(workspacePath: string): string {
		const knownExt: string[] = [ ".pwn", ".p", ".inc" ];
		const knownName: string[] = [ path.basename(workspacePath), "main" ]; // basename of workspacePath must return last directory name
		let mainFile: string = "";

		knownName.push("main");

		knownName.some((fileName) => {
			knownExt.some((ext) => {
				if (fs.existsSync(path.join(workspacePath, fileName + ext))) {
					mainFile = fileName + ext;
					return true;
				}

				return false;
			});

			return (mainFile.length > 0);
		});
	
		return mainFile;
	}

	static getParser(currentPath: string, autoCreate: boolean = true): Parser | undefined {
		for (let workspace of ParserManager.workspaces.keys()) {
			if (currentPath.indexOf(workspace) == -1) {
				continue;
			}

			const workspaceParser: Parser = ParserManager.parsers.get(workspace)!;

			if (workspaceParser.isInProgress()) {
				return undefined;
			}
		}

		const key: string = ParserManager.getCurrentPath(currentPath);
		let parser: Parser | undefined = ParserManager.parsers.get(key);

		// If parser of file not found(Workspaces parser already created), create parser
		if (parser === undefined && autoCreate) {
			parser = new Parser(key);
			ParserManager.parsers.set(key, parser);
		}
		// //

		return parser;
	}

	// Search parser key of file path //
	static getCurrentPath(originalPath: string): string {
		if (!isHaveWorkspaceFolderCapability()) {
			return originalPath;
		}

		// First, Check is file workspace main file? //
		for (let workspace of ParserManager.workspaces.keys()) {
			const workspaceParser: Parser = ParserManager.parsers.get(workspace)!;

			// If originalPath is workspace path or originalPath is workspace main file //
			const directory: string = path.dirname(originalPath);

			if (originalPath == workspace || (directory == workspace && path.basename(originalPath) == workspaceParser.getMainFile())) {
				return workspace;
			}
			// //
		}
		// //

		let currentPath: string = originalPath;

		// If file is not workspace main file, search workspaces include files //
		for (let workspace of ParserManager.workspaces.keys()) {
			// Ex) originalPath: C:\\test\\1\\2\\3 and workpsace: C:\\test is true. But false if originalPath is C:\\Windows\\notepad.exe //
			// Workspace parser only share that path //
			if (originalPath.indexOf(workspace) == -1) { 
				continue;
			}
			// //

			const workspaceParser: Parser = ParserManager.parsers.get(workspace)!;
			let isIncludeFile: boolean = false;

			workspaceParser.grammar.files.some((includeFile: PawnFile) => {
				if (includeFile.file_path == originalPath) {
					isIncludeFile = true;
					currentPath = workspace;
					return true;
				}

				return false;
			});

			if (isIncludeFile) {
				return currentPath;
			}
		}
		// //

		return originalPath;
	}
	// //

	static removeParser(currentPath: string): void {
		const key: string = ParserManager.getCurrentPath(currentPath);
		const parser: Parser | undefined = ParserManager.getParser(key, false);

		if (parser !== undefined) {
			this.parsers.delete(key);
		}
	}

	static getParsersValues(): IterableIterator<Parser> {
		return ParserManager.parsers.values();
	}

	static isWorkspaceInitialized(): boolean {
		return ParserManager.workspacesParserInitalized;
	}

	static updateGarbageCollect(workspaceParser: Parser): void {
		if (!isHaveWorkspaceFolderCapability() || !ParserManager.workspacesParserInitalized) {
			return;
		}

		for (let targetParser of ParserManager.parsers.entries()) {
			if (targetParser[1].isWorkspaceParser()) {
				continue;
			}

			const parser: Parser | undefined = ParserManager.getParser(targetParser[0], false);

			if (parser !== undefined && parser.isWorkspaceParser()) {
				ParserManager.parsers.delete(targetParser[0]);
			}
		}
	}
}