import * as path from "path";
import * as fs from "fs";
import { Connection, WorkspaceFolder } from 'vscode-languageserver';
import { getConnection, isHaveWorkspaceFolderCapability } from './server';
import { Parser } from "./Parser";
import { PawnFile } from './Grammar';
import * as assert from 'assert';
import { uriToFilePath } from 'vscode-languageserver/lib/files';

export class ParserManager {
	static connection: Connection;
	private static parsers: Map<string, Parser> = new Map();
	private static workspaces: Map<string, WorkspaceFolder> = new Map();

	// ParserManager should create workspaces parser //
	// Because if parser not found while getParser() call, getParser() create parser automatly every file path. //
	static createWorkspacesParser(workspaces: WorkspaceFolder[]) {
		assert(workspaces !== null);

		workspaces.forEach((workspace: WorkspaceFolder) => {
			const key: string = uriToFilePath(workspace.uri)!;
			const workspaceParser: Parser = new Parser(key, true);
			
			ParserManager.parsers.set(key, workspaceParser);
			workspaceParser.setMainFile(ParserManager.getWorkspaceDefaultMainFile(key)); // Automatly parser run

			ParserManager.workspaces.set(workspace.uri, workspace);
		});
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
		let currentPath: string = originalPath;

		if (!isHaveWorkspaceFolderCapability()) {
			return currentPath;
		}

		let isWorkspaceMain: boolean = false;

		// First, Check is file workspace main file? //
		for (let workspace of ParserManager.workspaces.values()) {
			const workspacePath: string = uriToFilePath(workspace.uri)!;
			const workspaceParser: Parser | undefined = ParserManager.parsers.get(workspacePath);

			if (workspaceParser !== undefined) {
				// If originalPath is workspace path or originalPath is workspace main file //
				const directory: string = path.dirname(originalPath);

				if (originalPath == workspacePath || (directory == workspacePath && path.basename(originalPath) == workspaceParser.getMainFile())) {
					isWorkspaceMain = true;
					currentPath = workspacePath;
					break;
				}
				// //
			}
		}
		// //

		// If file is not workspace main file, search workspaces include files //
		if (!isWorkspaceMain) {
			for (let workspace of ParserManager.workspaces.values()) {
				const workspacePath: string = uriToFilePath(workspace.uri)!;
				const workspaceParser: Parser | undefined = ParserManager.getParser(workspacePath);
				let isIncludeFile: boolean = false;

				if (workspaceParser !== undefined) {
					workspaceParser.grammar.files.some((includeFile: PawnFile) => {
						if (includeFile.file_path == originalPath) {
							isIncludeFile = true;
							currentPath = workspacePath;
							return true;
						}
					});
				}

				if (isIncludeFile) {
					break;
				}
			}
		}
		// //

		return currentPath;
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

	/*static setWorkspaceMainFile(fileName: string) {
		if (ParserManager.workspaceRoot === undefined) {
			return;
		}

		this.getParser(ParserManager.workspaceRoot).setMainFile(fileName);
	}*/
}