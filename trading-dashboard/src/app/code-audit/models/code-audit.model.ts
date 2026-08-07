export interface CodeAuditReference {
  file: string;
  line: number;
  context?: string;
}

export interface CodeAuditFunction {
  name: string;
  file: string;
  line: number;
  kind: 'method' | 'arrow-function' | 'function' | 'lifecycle-hook' | 'host-listener';
  referenceCount: number;
  status: 'used' | 'unused';
  references: CodeAuditReference[];
}

export interface CodeAuditComponent {
  selector: string;
  file: string;
  line: number;
  referenceCount: number;
  status: 'used' | 'unused';
  references: CodeAuditReference[];
}

export interface CodeAuditCss {
  selector: string;
  name: string;
  type: 'class' | 'id';
  file: string;
  line: number;
  referenceCount: number;
  status: 'used' | 'unused';
  references: CodeAuditReference[];
}

export interface CodeAuditSummary {
  typescriptFiles: number;
  htmlFiles: number;
  styleFiles: number;

  functionsFound: number;
  potentiallyUnusedFunctions: number;

  angularComponentsFound: number;
  potentiallyUnusedComponents: number;

  cssSelectorsFound: number;
  potentiallyUnusedCss: number;

  healthScore: number;
}

export interface CodeAuditMeta {
  project: string;
  generatedAt: string;
  scannerVersion: string;
}

export interface CodeAuditReport {
  meta: CodeAuditMeta;
  summary: CodeAuditSummary;

  functions: CodeAuditFunction[];
  components: CodeAuditComponent[];
  css: CodeAuditCss[];
}
