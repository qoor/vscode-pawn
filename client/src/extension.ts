import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";
import * as vscode from "vscode";
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from "vscode-languageclient";

let client: LanguageClient;
let outputChannel: vscode.OutputChannel | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
	let serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
	let debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	if (!isValidCompilerPath()) {
		showNeedCompilerPath();

		vscode.workspace.getConfiguration("pawn").update("compilerPath", context.asAbsolutePath("pawno"), true);
	}

	if ((vscode.workspace.getConfiguration("pawn").get("compileOptions") as string[]).length == 0) {
		vscode.workspace.getConfiguration("pawn").update("compileOptions", [ "-d1", "-O1", "-(", "-;" ], true);
	}

	let clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: "file", language: "pawn" }],
		synchronize: {
			fileEvents: vscode.workspace.createFileSystemWatcher("**/.clientrc")
		},
		initializationOptions: {
			compiler: {
				path: vscode.workspace.getConfiguration("pawn").get("compilerPath"),
				options: vscode.workspace.getConfiguration("pawn").get("compileOptions")
			},
			parserPath: context.asAbsolutePath("bin")
		}
	};

	client = new LanguageClient(
		"pawnServerExample",
		"PAWN Language Server",
		serverOptions,
		clientOptions
	);

	client.onReady().then(() => {
		client.onRequest("compile", runCompile);
	});

	client.start();

	let disposible = vscode.commands.registerTextEditorCommand("pawn.compile", requestCompile);
	context.subscriptions.push(disposible);

	console.log("PAWN Language extension activated.");
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}

	return client.stop();
}

function requestCompile(textEditor: vscode.TextEditor): void {
	if (textEditor.document.languageId !== "pawn") {
		return;
	}

	if (!isValidCompilerPath()) {
		showNeedCompilerPath();
		return;
	}

	client.sendRequest("compile_request", textEditor.document.uri.toString());
}

function runCompile(args: { args: string[] }) {
	if (outputChannel === undefined) {
		outputChannel = vscode.window.createOutputChannel("PAWN Compiler");
	}

	const argList: string[] = args.args;

	outputChannel.clear();
	outputChannel.appendLine("Compiling \"" + argList[0] + "\"...");
	outputChannel.appendLine("");

	const compiler: ChildProcess =
		spawn(path.join(vscode.workspace.getConfiguration("pawn").get("compilerPath"), "pawncc.exe"), argList, { cwd: path.dirname(argList[0]) }); // args[0] always give full path

	compiler.on("error", (err: Error) => {
		outputChannel.appendLine("Compilation aborted.");
		outputChannel.appendLine("Result: " + err.message);
	});

	compiler.stderr.on("data", (chunk: string) => {
		if (chunk) {
			outputChannel.append(chunk.toString());
		}
	});

	compiler.stdout.on("data", (chunk: string) => {
		if (chunk) {
			outputChannel.append(chunk.toString());
		}
	});

	outputChannel.show(false);
}

function showNeedCompilerPath(): void {
	vscode.window.showErrorMessage("You have not valid PAWN compiler path.\n\
		Please configure compiler path.\n** DO NOT include compiler name, Just path. **\n\nCompiler name must be \"pawncc.exe\" in compiler path");
}

function isValidCompilerPath(): boolean {
	let compilerPath: string = (vscode.workspace.getConfiguration("pawn").get("compilerPath") as string);

	if (compilerPath.length == 0) {
		console.log(vscode.extensions.getExtension("pawn").extensionPath);
		compilerPath = path.join(vscode.extensions.getExtension("pawn").extensionPath, "pawno");
	}

	return (compilerPath.length > 0 && fs.existsSync(path.join(compilerPath, "pawncc.exe")));
}
