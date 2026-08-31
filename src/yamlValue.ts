/** Every value a workflow document can hold, and so everything read out of one. */
export type YamlValue = string | number | boolean | null | YamlValue[] | YamlMap;

/** A mapping. `undefined` belongs to the read of an absent key, never to the document. */
export type YamlMap = { [key: string]: YamlValue | undefined };
