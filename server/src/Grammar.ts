import { getConnection, SYMBOL_NAME_REGEX } from "./server";
import { TextDocument, Range, Connection } from 'vscode-languageserver';
import * as path from "path";
import * as assert from "assert";

const RAWMODE	= 1;
const UTF8MODE	= 2;
const STRINGIZE	= 4;

const iLABEL		= 0;
const iVARIABLE		= 1;   /* cell that has an address and that can be fetched directly (lvalue) */
const iREFERENCE 	= 2;   /* iVARIABLE, but must be dereferenced */
const iARRAY		= 3;
const iREFARRAY		= 4;   /* an array passed by reference (i.e. a pointer) */
const iARRAYCELL	= 5;   /* array element, cell that must be fetched indirectly */
const iARRAYCHAR	= 6;   /* array element, character from cell from array */
const iEXPRESSION	= 7;   /* expression result, has no address (rvalue) */
const iCONSTEXPR	= 8;   /* constant expression (or constant symbol) */
const iFUNCTN		= 9;
const iREFFUNC		= 10;
const iVARARGS		= 11;  /* function specified ... as argument(s) */

/*  Possible entries for "usage"
 *
 *  This byte is used as a serie of bits, the syntax is different for
 *  functions and other symbols:
 *
 *  VARIABLE
 *  bits: 0     (uDEFINE) the variable is defined in the source file
 *        1     (uREAD) the variable is "read" (accessed) in the source file
 *        2     (uWRITTEN) the variable is altered (assigned a value)
 *        3     (uCONST) the variable is constant (may not be assigned to)
 *        4     (uPUBLIC) the variable is public
 *        6     (uSTOCK) the variable is discardable (without warning)
 *
 *  FUNCTION
 *  bits: 0     (uDEFINE) the function is defined ("implemented") in the source file
 *        1     (uREAD) the function is invoked in the source file
 *        2     (uRETVALUE) the function returns a value (or should return a value)
 *        3     (uPROTOTYPED) the function was prototyped (implicitly via a definition or explicitly)
 *        4     (uPUBLIC) the function is public
 *        5     (uNATIVE) the function is native
 *        6     (uSTOCK) the function is discardable (without warning)
 *        7     (uMISSING) the function is not implemented in this source file
 *        8     (uFORWARD) the function is explicitly forwardly declared
 *
 *  CONSTANT
 *  bits: 0     (uDEFINE) the symbol is defined in the source file
 *        1     (uREAD) the constant is "read" (accessed) in the source file
 *        2     (uWRITTEN) redundant, but may be set for constants passed by reference
 *        3     (uPREDEF) the constant is pre-defined and should be kept between passes
 *        5     (uENUMROOT) the constant is the "root" of an enumeration
 *        6     (uENUMFIELD) the constant is a field in a named enumeration
 */
const uDEFINE		= 0x001;
const uREAD			= 0x002;
const uWRITTEN		= 0x004;
const uRETVALUE		= 0x004; /* function returns (or should return) a value */
const uCONST		= 0x008;
const uPROTOTYPED 	= 0x008;
const uPREDEF		= 0x008; /* constant is pre-defined */
const uPUBLIC		= 0x010;
const uNATIVE		= 0x020;
const uENUMROOT		= 0x020;
const uSTOCK		= 0x040;
const uENUMFIELD	= 0x040;
const uMISSING		= 0x080;
const uFORWARD		= 0x100;

const uTAGOF	= 0x40;  /* set in the "hasdefault" field of the arginfo struct */
const uSIZEOF	= 0x80;  /* set in the "hasdefault" field of the arginfo struct */

enum eArrayType {
	INTEGER = 1,
	ENUMERATOR
}

export interface PawnFile {
	file_path: string;
	number: number;
}

export interface PawnSymbol {
	name: string;
	ident: number;
	usage: number;
	tagid: number;
	file_number: number;

	detail: string;
}

interface PawnConstantExpression extends PawnSymbol {
	array: PawnArray[];
	value: number;
}

export interface PawnEnumeratorField extends PawnConstantExpression {
	parent: PawnEnumerator;
}

interface PawnArray {
	array_type: eArrayType;
	array_value: number;
}

interface PawnVariable extends PawnSymbol {
	array: PawnArray[];
}

interface PawnEnumerator extends PawnSymbol {
	field: PawnEnumeratorField[];
}

interface PawnArgument extends PawnSymbol {
	dimension: number;
	tag_list: number[];
	hasdefault: number;
	default_value: number | string;
	reference: number | string;
	reference_value: number;
}

export interface PawnFunction extends PawnSymbol {
	argument: PawnArgument[];
}

export interface PawnSubstitute {
	pattern: string;
	match_length: number;
	substitution: string;
	detail: string;
}

interface PawnConstantValue {
	name: string;
	value: number;
	index: number;
	detail: string;
	isConstantValue: boolean;
}

interface PawnTag extends PawnConstantValue {

}

export class Grammar
{
	connection: Connection;
	files: PawnFile[] = [];
	enumerators: PawnEnumerator[] = [];
	functions: PawnFunction[] = [];
	variables: PawnSymbol[] = [];
	substitutions: PawnSubstitute[] = [];
	constantExpressions: PawnConstantExpression[] = [];
	tags: PawnTag[] = [];

	constructor() {
		this.connection = getConnection();
		this.clear();
	}

	clear() {
		this.files = [];
		this.enumerators = [];
		this.functions = [];
		this.variables = [];
		this.substitutions = [];
		this.tags = [];
	}

	addFiles(files: PawnFile[]) {
		files = this.removeRedefinations(files, "file_path");

		files.forEach((value: PawnFile) => {
			value.file_path = path.normalize(value.file_path);
		});

		this.files = [];
		this.files = this.files.concat(files);
	}
	addEnumerators(enumerators: PawnEnumerator[]) {
		enumerators = this.removeRedefinations(enumerators, "name");

		enumerators.forEach((value: PawnEnumerator) => {
			value.field.forEach((field: PawnConstantExpression) => {
				this.addConstantExpression(field);
			});
		});

		this.enumerators = [];
		this.enumerators = this.enumerators.concat(enumerators);
	}
	addFunctions(functions: PawnFunction[]) {
		functions = this.removeRedefinations(functions, "name");

		this.functions = [];
		this.functions = this.functions.concat(functions);
	}
	addVariables(variables: PawnVariable[]) {
		this.variables = this.variables.concat(variables);
		this.variables = this.removeRedefinations(this.variables, "name");
	}
	addSubstitutes(substitutions: PawnSubstitute[]) {
		substitutions = substitutions.filter((value: PawnSubstitute) => { return (value.pattern.indexOf("|||") == -1); });
		substitutions = this.removeRedefinations(substitutions, "pattern");
		
		this.substitutions = [];
		this.substitutions = this.substitutions.concat(substitutions);
	}
	addConstantExpressions(constantExpressions: PawnConstantExpression[]) {
		constantExpressions = this.removeRedefinations(constantExpressions, "name");

		this.constantExpressions = [];
		this.constantExpressions = this.constantExpressions.concat(constantExpressions);
	}
	addTags(tags: PawnTag[]) {
		tags = this.removeRedefinations(tags, "name");

		this.tags = [];
		this.tags = this.tags.concat(tags);
	}
	
	addConstantExpression(constantExpression: PawnConstantExpression) {
		this.constantExpressions.push(constantExpression);
	}

	makeDetailAll() {
		for (let i = 0; i < this.enumerators.length; ++i) {
			this.makeDetail(this.enumerators[i]);
		}

		for (let i = 0; i < this.functions.length; ++i) {
			this.makeDetail(this.functions[i]);
		}

		for (let i = 0; i < this.variables.length; ++i) {
			this.makeDetail(this.variables[i]);
		}

		for (let i = 0; i < this.substitutions.length; ++i) {
			this.makeDetail(this.substitutions[i]);
		}

		this.constantExpressions = this.removeRedefinations(this.constantExpressions, "name");

		for (let i = 0; i < this.constantExpressions.length; ++i) {
			this.makeDetail(this.constantExpressions[i]);
		}

		for (let i = 0; i < this.tags.length; ++i) {
			this.makeDetail(this.tags[i]);
		}
	}

	private removeRedefinations(array: any[], key: string) {
		return array.filter((item, i) => {
			return array.findIndex((item2, j) => {
				return (item[key] == item2[key] &&
					(!("file_number" in item) || (item["file_number"] == -1 && item2["file_number"] == -1) || (item["file_number"] == item2["file_number"])));
			}) === i;
		});
	}

	static findMatchName(source: any[], name: string): number | boolean {
		for (let i = 0; i < source.length; ++i) {
			if (source[i].name === name) {
				return i;
			}
		}

		return false;
	}

	static isSymbol(symbol: any): symbol is PawnSymbol {
		return "ident" in symbol;
	}
	static isEnumerator(symbol: PawnSymbol): symbol is PawnEnumerator {
		return (symbol.ident == iCONSTEXPR && (symbol.usage & uENUMROOT) == uENUMROOT);
	}
	static isEnumeratorField(symbol: PawnSymbol): symbol is PawnEnumeratorField {
		return (symbol.ident == iCONSTEXPR && (symbol.usage & uENUMFIELD) == uENUMFIELD);
	}
	static isConstExpression(symbol: PawnSymbol): symbol is PawnConstantExpression {
		return (symbol.ident == iCONSTEXPR && (symbol.usage & (uENUMROOT | uENUMFIELD)) == 0);
	}
	static isFunction(symbol: PawnSymbol): symbol is PawnFunction {
		return (symbol.ident == iFUNCTN);
	}
	static isVariable(symbol: PawnSymbol): symbol is PawnVariable {
		return (!("dimension" in symbol) && (symbol.ident == iVARIABLE || symbol.ident == iARRAY));
	}
	static isArgument(symbol: PawnSymbol): symbol is PawnArgument {
		return ((symbol.ident == iVARIABLE || symbol.ident == iREFERENCE || symbol.ident == iREFARRAY || symbol.ident == iVARARGS) &&
			("dimension" in symbol));
	}
	static isSubstitute(symbol: any): symbol is PawnSubstitute {
		return "pattern" in symbol;
	}
	static isConstantValue(symbol: any): symbol is PawnConstantValue {
		return "isConstValue" in symbol;
	}

	makeDetail(symbol: PawnSymbol | PawnSubstitute | PawnConstantValue, targetDetailSymbol: PawnSymbol | undefined = undefined) {
		if (Grammar.isSubstitute(symbol)) {
			symbol.detail = "#define " + symbol.pattern;
			
			if (symbol.substitution.length > 0) {
				symbol.detail += ' ' + symbol.substitution;
			}

			return;
		}

		if (Grammar.isConstantValue(symbol)) {
			symbol.detail = symbol.name + ':';
			return;
		}
		let detail: string = "";

		symbol.detail = "";

		if (symbol.file_number > 0/* && (Grammar.isVariable(symbol) || Grammar.isFunction(symbol))*/) {
			detail = "static ";
		}

		if (Grammar.isEnumerator(symbol)) {
			detail += "enum ";
		}
		else {
			if (Grammar.isFunction(symbol)) {
				detail += ((symbol.usage & uNATIVE) == uNATIVE) ? "native " : "forward ";
			}

			if ((symbol.usage & uENUMFIELD) == 0 && (symbol.usage & uSTOCK) == uSTOCK) {
				detail += "stock ";
			}

			if (Grammar.isVariable(symbol)) {
				detail += "new ";
			}
		}

		if (!Grammar.isFunction(symbol) && (symbol.usage & uCONST) == uCONST) {
			detail += "const ";
		}

		if (symbol.ident == iREFERENCE) {
			detail += '&';
		}

		if (!Grammar.isEnumerator(symbol)) {
			let tagList: number[] = [];

			if (Grammar.isArgument(symbol)) {
				tagList = tagList.concat(symbol.tag_list);
			} else {
				tagList.push(symbol.tagid);
			}

			if (tagList.length > 1) {
				detail += '{';
			}

			tagList.forEach((inputTag: number, inputIndex: number) => {
				if (inputTag != 0 || tagList.length > 1) {
					this.tags.some((tagData: PawnTag) => {
						if (inputTag == tagData.value) {
							if (inputIndex > 0) {
								detail += ', ';
							}

							detail += tagData.name;
							return true;
						}

						return false;
					});
				}
			});

			if (tagList.length > 1) {
				detail += '}';
			}
			
			if (tagList.length > 0 && tagList[0] != 0) {
				detail += ": ";
			}
		}

		detail += symbol.name;

		if (Grammar.isVariable(symbol)) {
			for (let i = 0; i < symbol.array.length; ++i) {
				if (symbol.array[i].array_type == eArrayType.INTEGER) {
					detail += '[' + symbol.array[i].array_value + ']';
				} else {
					this.enumerators.some((value: PawnEnumerator) => {
						if (value.tagid == symbol.array[i].array_value) {
							detail += '[' + value.name + ']';
							return true;
						}

						return false;
					});
				}
			}
		}
		else if (symbol.ident == iREFARRAY) {
			for (let i = 0; i < (symbol as PawnArgument).dimension; ++i) {
				detail += "[]";
			}
		}
		else if (symbol.ident == iCONSTEXPR && (symbol.usage & uENUMFIELD) == uENUMFIELD) {
			const enumSymbol = symbol as PawnConstantExpression;

			if (enumSymbol.array[0].array_type == eArrayType.INTEGER) {
				if (enumSymbol.array[0].array_value > 1) {
					detail += '[' + enumSymbol.array[0].array_value + ']';
				}
			} else {
				this.enumerators.some((value: PawnEnumerator) => {
					if (value.tagid == enumSymbol.array[0].array_value) {
						detail += '[' + value.name + ']';
						return true;
					}

					return false;
				});
			}
		}

		if (Grammar.isArgument(symbol)) {
			let argument: PawnArgument = symbol as PawnArgument;
			let reference: string | undefined = undefined;

			if (argument.hasdefault) {
				if (typeof argument.reference == "number") {
					if (argument.reference != 0) {
						for (let i = 0; i < this.constantExpressions.length; ++i) {
							if (argument.reference == this.constantExpressions[i].tagid && argument.reference_value == this.constantExpressions[i].value) {
								reference = this.constantExpressions[i].name;
								break;
							}
						}
					}
				}

				detail += " = ";

				if (reference) {
					detail += reference;
				} else {
					if (typeof argument.default_value == "number" || argument.default_value.length > 0) {
						detail += argument.default_value;
					} else {
						detail += "\"\"";
					} 
				}
			}
		}

		symbol.detail = detail;

		if (targetDetailSymbol !== undefined) {
			targetDetailSymbol.detail += detail;
		} else {
			if (Grammar.isFunction(symbol)) {
				let func: PawnFunction = symbol as PawnFunction;

				func.detail += '(';

				if (func.argument) {
					for (let i = 0; i < func.argument.length; ++i) {
						if (i != 0) {
							func.detail += ", ";
						}

						this.makeDetail(func.argument[i], func);
					}
				}

				func.detail += ')';
			}
			else if (Grammar.isEnumerator(symbol)) {
				let enumerator: PawnEnumerator = symbol as PawnEnumerator;

				enumerator.detail += '\n{\n';

				if (enumerator.field) {
					for (let i = 0; i < enumerator.field.length; ++i) {
						if (i == 0) {
							enumerator.detail += '\t';
						} else {
							enumerator.detail += ",\n\t";
						}

						enumerator.field[i].parent = enumerator;
						this.makeDetail(enumerator.field[i], enumerator);
					}
				}

				enumerator.detail += "\n}";
			}
		}
	}

	makeSubstituteHoverString(document: TextDocument, startOffset: number): string {
		const position = document.positionAt(startOffset);
		let text: string = document.getText(Range.create(position.line, position.character, position.line, Number.MAX_VALUE)) + '\n';
		let start: number = 0, end: number;
		let prefixLength: number;
		let substitute: PawnSubstitute | undefined = undefined;
		let lastNotSubstitutedText: string = "";
		let firstSubstitute: boolean = true;

		start = 0;

		while (start < text.length) {
			while (start < text.length && !/[a-zA-Z_@]/.test(text[start])) {
				++start;
			}

			if (start >= text.length) {
				break;
			}
			
			if (start + 7 < text.length && text.substr(start, 7) == "defined" && text.charCodeAt(start + 7) <= ' '.charCodeAt(0)) {
				start += 7;

				while ((start < text.length && text.charCodeAt(start) <= ' '.charCodeAt(0)) || text[start] == '(') {
					++start;
				}

				while (start < text.length && SYMBOL_NAME_REGEX.test(text[start])) {
					++start;
				}

				continue;
			}

			prefixLength = 0;
			end = start;

			while (end < text.length && SYMBOL_NAME_REGEX.test(text[end])) {
				++prefixLength;
				++end;
			}

			assert(prefixLength > 0);
			const fixedText: string = text.substr(start);
			substitute = this.substitutions.find((value: PawnSubstitute) => {
				return this.symbolFinder(value, fixedText, -1, prefixLength);
			});

			if (substitute !== undefined) {
				const substituted: { text: string, end: number } = this.substitutePattern(fixedText, substitute);

				lastNotSubstitutedText = text.substr(start + substituted.end);

				text = text.substring(0, start) + substituted.text;
				
				if (firstSubstitute) {
					firstSubstitute = false;
				} else {
					text += lastNotSubstitutedText;
				}
			} else {
				start = end;
			}
		}

		return text;
	}

	substitutePattern(text: string, substitute: PawnSubstitute): { text: string, end: number } {
		let prefixLength: number = 0;
		let start: number;
		let end: number = 0;
		let match: boolean = true;
		let patternOffset: number;
		let argument: number = 0;
		let args: Array<string> = new Array(10);
		let argumentHave: Array<boolean> = new Array(10);
		let length: number;
		let inString: boolean;
		let returnString: string = "";
		let originalTextStart: number = -1;
		let originalTextEnd: number = -1;

		for (prefixLength = 0, start = 0; start < substitute.pattern.length && SYMBOL_NAME_REGEX.test(substitute.pattern[start]); ++prefixLength, ++start) {
			/* nothing */
		}

		assert(prefixLength > 0);
		assert(text.indexOf(substitute.pattern.substr(0, prefixLength)) == 0);

		start = prefixLength;
		patternOffset = prefixLength;

		while (match && start < text.length && patternOffset < substitute.pattern.length) {
			if (substitute.pattern[patternOffset] == '%') {
				++patternOffset;

				if (/[0-9]/.test(substitute.pattern[patternOffset])) {
					argument = Number(substitute.pattern[patternOffset]);

					assert(argument >= 0 && argument <= 9);
					assert((++patternOffset) < substitute.pattern.length);

					end = start;

					while (end < text.length && text[end] != '\n' && text[end] != substitute.pattern[patternOffset]) {
						if (Grammar.isStartString(text.substr(end, 3))) {
							end = Grammar.skipString(text, end);
						}
						else if ("({[".indexOf(text[end]) >= 0) {
							end = Grammar.skipGroup(text, end);
						}

						if (end < text.length) {
							++end;
						}
					}

					length = end - start;

					args[argument] = text.substr(start, length);
					argumentHave[argument] = true;

					if (text[end] == substitute.pattern[patternOffset]) {
						start = end + 1;
					}
					/*else if (text[end] == '\n' && substitute.pattern[patternOffset] == ';' && patternOffset + 1 >= substitute.pattern.length) { // If not need semicolon
						start = end;
					}*/
					else {
						assert(end >= text.length || text[end] == '\n');

						match = false;
						start = end;
					}

					++patternOffset;
				} else {
					match = false;
				}
			}
			/*else if (substitute.pattern[patternOffset] == ';' && patternOffset + 1 >= substitute.pattern.length) { // If not need semicolon
				while (start < text.length && text.charCodeAt(start) <= ' '.charCodeAt(0)) {
					++start;
				}

				if (text[start] != ';' && start != text.length) {
					match = false;
				}
			}*/
			else {
				let char: { offset: number, character: string };

				assert(patternOffset > 0);

				if (!SYMBOL_NAME_REGEX.test(substitute.pattern[patternOffset]) && substitute.pattern[patternOffset - 1] != substitute.pattern[patternOffset]) {
					while (start < text.length && text.charCodeAt(start) <= ' '.charCodeAt(0)) {
						++start;
					}
				}

				if (originalTextStart == -1) {
					originalTextStart = start;
				}

				char = Grammar.getLiteralCharacter(substitute.pattern, patternOffset);
				patternOffset = char.offset;

				if (text[start] != char.character) {
					match = false;
				} else {
					++start;
				}
			}
		}

		if (match && patternOffset >= substitute.pattern.length) {
			assert(patternOffset > 0);

			if (SYMBOL_NAME_REGEX.test(substitute.pattern[patternOffset - 1]) && SYMBOL_NAME_REGEX.test(text[start])) {
				match = false;
			}
		}

		originalTextEnd = start;

		if (match) {
			inString = false;

			for (end = 0, start = 0; end < substitute.substitution.length; ++end) {
				if (substitute.substitution[end] == '%' && /[0-9]/.test(substitute.substitution[end + 1]) && !inString) {
					argument = Number(substitute.substitution[end + 1]);

					assert(argument >= 0 && argument <= 9);

					if (argumentHave[argument]) {
						returnString += args[argument];
					} else {
						returnString += substitute.substitution.substr(end, 2);
						start += 2;
					}

					++end;
				} else {
					if (substitute.substitution[end] == '"') {
						inString = !inString;
					}

					returnString += substitute.substitution[end];
				}
			}

			//attachString += text.substr(originalTextEnd);
		}

		return { text: returnString, end: originalTextEnd };
	}

	private static isStartString(line: string): boolean {
		let char = line[0];

		if (char == '"' || char == '\'') {
			return true;
		}

		if (char == '!') {
			char = line[1];

			if (char == '"' || char == '\'') {
				return true;
			}

			if (char == '\\') {
				char = line[2];

				if (char == '"' || char == '\'') {
					return true;
				}
			}
		}
		else if (char == '\\') {
			char = line[1];

			if (char == '"' || char == '\'') {
				return true;
			}

			if (char == '!') {
				char = line[2];

				if (char == '"' || char == '\'') {
					return true;
				}
			}
		}

		return false;
	}

	private static skipString(line: string, startIndex: number): number {
		let endQuote: string;
		let flags: number = 0;
		let i: number = startIndex;
		let char: { offset: number, character: string };

		while (i < line.length && line[i] == '!' || line[i] == '\\') {
			if (line[i] == '\\') {
				flags = RAWMODE;
			}

			++i;
		}

		endQuote = line[i];

		assert(endQuote == '"' || endQuote == '\'');

		++i;

		while (i < line.length && line[i] != endQuote) {
			char = Grammar.getLiteralCharacter(line, flags);
			i = char.offset;
		}

		return i;
	}

	private static skipGroup(line: string, startIndex: number) {
		let nest: number = 0;
		let i: number = startIndex;
		let open: string = line[i];
		let close: string;

		switch (open) {
			case '(':
			{
				close = ')';
				break;
			}
			case '{':
			{
				close = '}';
				break;
			}
			case '[':
			{
				close = ']';
				break;
			}
			case '<':
			{
				close = '>';
				break;
			}
			default:
			{
				try {
					throw new Error("Unknown group character.");
				} catch (e) {
					alert(e.message);
				}

				close = '\0';
			}
		}

		++i;

		while (line[i] != close || nest > 0) {
			if (line[i] == open) {
				++nest;
			} else if (line[i] == close) {
				--nest;
			} else if (Grammar.isStartString(line.substr(i, 3))) {
				i = Grammar.skipString(line, i);
			}

			if (i >= line.length) {
				break;
			}

			++i;
		}

		return i;
	}

	private static getLiteralCharacter(line: string, startIndex: number, flags: number = 0): { offset: number, character: string } {
		let i: number = startIndex;
		let character: number = 0;

		if ((flags & RAWMODE) != 0 || line[i] != '\\') {
			character = line.charCodeAt(i);
			++i;
		} else {
			++i;

			if (line[i] == '\\') {
				character = line.charCodeAt(i);
				++i;
			}

			switch (line[i]) {
				case 'a':
				{
					character = 7;
					++i;
					break;
				}
				case 'b':
				{
					character = 8;
					++i;
					break;
				}
				case 'e':
				{
					character = 27;
					++i;
					break;
				}
				case 'f':
				{
					character = 12;
					++i;
					break;
				}
				case 'n':
				{
					character = 10;
					++i;
					break;
				}
				case 'r':
				{
					character = 13;
					++i;
					break;
				}
				case 't':
				{
					character = 9;
					++i;
					break;
				}
				case 'v':
				{
					character = 11;
					++i;
					break;
				}
				case 'x':
				{
					character = 0;
					++i;

					while (Grammar.isHex(line[i])) {
						if (/[0-9]/.test(line[i])) {
							character = (character << 4) + Number(line[i]);
						} else {
							character = (character << 4) + (line.toLowerCase().charCodeAt(i) - 'a'.charCodeAt(0) + 10);
						}

						++i;
					}

					if (line[i] == ';') {
						++i;
					}

					break;
				}
				case '\'':
				case '"':
				case '%':
				{
					character = line.charCodeAt(i);
					++i;
					break;
				}
				case '#':
				case ',':
				case ';':
				case ')':
				case '}':
				{
					if (flags & STRINGIZE) {
						character = line.charCodeAt(i);
						++i;
					}

					break;
				}
				default:
				{
					if (/[0-9]/.test(line[i])) {
						character = 0;

						while (line.charCodeAt(i) >= '0'.charCodeAt(0) && line.charCodeAt(i) <= '9'.charCodeAt(0)) {
							character = (character * 10) + (i++ - '0'.charCodeAt(0));
						}

						if (line[i] == ';') {
							++i;
						}
					}
				}
			}
		}

		return { offset: i, character: String.fromCharCode(character) };
	}

	private static isHex(character: string) {
		let charCode: number = character.charCodeAt(0);

		return (charCode >= '0'.charCodeAt(0) && charCode <= '9'.charCodeAt(0)) ||
			(charCode >= 'a'.charCodeAt(0) && charCode <= 'f'.charCodeAt(0)) ||
			(charCode >= 'A'.charCodeAt(0) && charCode <= 'F'.charCodeAt(0));
	}

	symbolFinder(symbol: PawnSubstitute | PawnSymbol | PawnConstantValue, name: string = "", fileNumber: number = -1, prefixLength: number = 0): boolean {
		if (Grammar.isSubstitute(symbol)) {
			return (name.length == 0 || name.substr(0, prefixLength) == symbol.pattern.substr(0, symbol.match_length));
		} else if (Grammar.isConstantValue(symbol) || Grammar.isConstExpression(symbol)) {
			return (name.length == 0 || name === symbol.name);
		} else {
			return ((name.length == 0 || name === symbol.name) && (symbol.file_number == -1 || (fileNumber == symbol.file_number)));
		}
	}

	getFileNumber(filePath: string): number {
		const fileData: PawnFile | undefined = this.files.find((value) => { return (path.normalize(value.file_path) == path.normalize(filePath)); });

		if (fileData !== undefined) {
			return fileData.number;
		}

		return -1;
	}
}