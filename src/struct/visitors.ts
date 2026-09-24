import { parser } from './parser.ts';

export const BaseStructVisitor = parser.getBaseCstVisitorConstructor<unknown, unknown>();
export const BaseStructVisitorWithDefaults = parser.getBaseCstVisitorConstructorWithDefaults<unknown, unknown>();
