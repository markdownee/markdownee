// `title` and `description` are vanilla JSON Schema keywords and live on the
// Zod side: use `.describe('...')` for description and `.meta({ title: '...' })`
// for the form label. The Apify-only UI hints below are typed by this interface
// so a typo or wrong editor name fails the type-check; they are attached to each
// field via `.register(apifyRegistry, { … })` (see `apify-registry.ts`), NOT
// inline in `.meta()`, keeping the exported Zod source Apify-agnostic.

export interface ApifyMeta {
  editor?:
    | 'textfield'
    | 'textarea'
    | 'number'
    | 'checkbox'
    | 'select'
    | 'json'
    | 'datepicker'
    | 'requestListSources'
    | 'pseudoUrls'
    | 'globs'
    | 'keyValue'
    | 'stringList'
    | 'proxy'
    | 'fileupload'
    | 'hidden'
    | 'resourcePicker'
    | 'schemaBased'
    | 'javascript'
    | 'python';
  prefill?: unknown;
  sectionCaption?: string;
  sectionDescription?: string;
  groupCaption?: string;
  groupDescription?: string;
  enumTitles?: string[];
  enumSuggestedValues?: string[];
  isSecret?: boolean;
  nullable?: boolean;
  unit?: string;
  dateType?: string;
  resourceType?: 'dataset' | 'keyValueStore' | 'requestQueue';
  resourcePermissions?: string[];
  patternKey?: string;
  patternValue?: string;
  placeholderKey?: string;
  placeholderValue?: string;
  mcpServers?: unknown;
}
