export interface GqlTypeRef {
  kind: string;
  name: string | null;
  ofType: GqlTypeRef | null;
}

export interface GqlArg {
  name: string;
  description: string | null;
  type: GqlTypeRef;
  defaultValue: string | null;
}

export interface GqlField {
  name: string;
  description: string | null;
  args: GqlArg[];
  type: GqlTypeRef;
}

export interface IntrospectionResult {
  __schema: {
    queryType: { fields: GqlField[] } | null;
    mutationType: { fields: GqlField[] } | null;
  };
}

export interface SchemaFilters {
  includeMutations: boolean;
  maxTools: number;
}

export interface ExecutorConfig {
  apiUrl: string;
  headers: Record<string, string>;
  maxRetries: number;
  secrets: string[];
}

export interface McpToolResult {
  [key: string]: unknown;
  content: { text: string; type: "text" }[];
  isError?: boolean;
}
