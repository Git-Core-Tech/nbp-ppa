interface FieldDef {
    pos: number;
    len: number;
    type: 'varchar' | 'number' | 'number_2dp' | 'textdate' | 'binary';
}
export declare const TMI_FIELDS: Record<string, FieldDef>;
export declare const TMI_MESSAGE_LENGTH = 1365;
export type ParsedTmi = Record<string, string>;
export declare function parseTmi1910(raw: string): ParsedTmi;
export {};
