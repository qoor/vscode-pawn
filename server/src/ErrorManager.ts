import * as path from "path";
import { getConnection } from "./server";
import { Diagnostic, TextDocument, Connection, DiagnosticSeverity, Position, Range } from 'vscode-languageserver';
import { uriToFilePath } from 'vscode-languageserver/lib/files';

enum eErrorType {
	ERROR = 1,
	FATAL_ERROR,
	WARNING
}

export interface PawnError {
	file_name: string;
	error_id: number;
	first_line: number;
	last_line: number;
	error_type: eErrorType;
	error_message: string;
	error_detail: string;
}

export class ErrorManager {
	connection: Connection;
	errors: PawnError[] = [];

	constructor() {
		this.connection = getConnection();
		this.clear();
	}

	clear() {
		this.errors = [];
	}

	addError(errorData: PawnError): void {
		errorData.file_name = path.normalize(errorData.file_name);
		this.makeDetail(errorData);

		this.errors.push(errorData);
	}

	getDiagnostics(document: TextDocument) {
		let diagnostics: Diagnostic[] = [];
		let documentPath: string = uriToFilePath(document.uri)!;

		for (let i = 0; i < this.errors.length; ++i) {
			if (this.errors[i].file_name == documentPath) {
				//let position: { startPosition: Position, lastPosition: Position } = this.getDiagnosticStartPosition(document, this.errors[i].first_line - 1, this.errors[i].last_line - 1);
				let diagnostic: Diagnostic = {
					severity: (this.errors[i].error_type == eErrorType.WARNING) ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
					range: {
						start: Position.create((this.errors[i].first_line != -1) ? this.errors[i].first_line - 1 : this.errors[i].last_line - 1, 0),
						end: Position.create(this.errors[i].last_line - 1, Number.MAX_VALUE)
					},
					message: this.errors[i].error_detail
				};

				diagnostics.push(diagnostic);
			}
		}

		return diagnostics;
	}

	/*private getDiagnosticStartPosition(document: TextDocument, firstLine: number, lastLine: number): { startPosition: Position, lastPosition: Position } {
		const fixedFirstLine: number = (firstLine == -1) ? lastLine : firstLine;
		const text: string = document.getText();
		let startOffset: number = document.offsetAt(Position.create(fixedFirstLine, 0));
		let lastOffset = document.offsetAt(Position.create(lastLine, Number.MAX_VALUE));
		let minLastOffset = document.offsetAt(Position.create(lastLine, 0));

		for (let i = startOffset; text[i] != '\n'; ++i) {
			if (!/\s/.test(text[i])) {
				startOffset = i;
				break;
			}
		}

		for (let i = lastOffset; i >= minLastOffset; --i) {
			if (!/\s/.test(text[i])) {
				lastOffset = i;
				break;
			}
		}

		return { startPosition: document.positionAt(startOffset), lastPosition: document.positionAt(lastOffset) };
	}*/

	private makeDetail(errorData: PawnError) {
		let detail: string = path.basename(errorData.file_name);

		detail = errorData.file_name;

		if (errorData.first_line >= 0) {
			detail += '(' + errorData.first_line + " -- " + errorData.last_line + " : ";
		} else {
			detail += '(' + errorData.last_line + ')' + " : ";
		}

		if (errorData.error_type == eErrorType.ERROR) {
			detail += "error ";
		} else if (errorData.error_type == eErrorType.WARNING) {
			detail += "warning ";
		} else if (errorData.error_type == eErrorType.FATAL_ERROR) {
			detail += "fatal error ";
		}

		detail += errorData.error_id.toString(3) + ": " + errorData.error_message.replace(/[\n]/g, '');

		errorData.error_detail = detail;
	}
}