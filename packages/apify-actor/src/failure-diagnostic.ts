function redact(text: string): string {
  // Ignore continuation lines rather than risk logging folded header or payload values.
  return (text.slice(0, 1000).split(/[\r\n]/, 1)[0] ?? '')
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi, '[redacted URL]')
    .replace(
      /\b((?:[a-z]+[_-])*token|(?:access|refresh)Token|api[_-]?key|(?:(?:client|proxy)[_-]?)?password|passwd|(?:client[_-]?)?secret|credentials?|authorization|proxy[_-]?authorization|(?:set[_-]?)?cookie)["']?\s*[:=]\s*[^\r\n]*/gi,
      '$1=[redacted]',
    )
    .replace(/\p{Cc}/gu, ' ')
    .slice(0, 1000);
}

/** Log only bounded exception text, never arbitrary thrown objects or raw stacks. */
export function failureDiagnostic(error: unknown): {
  readonly name: string;
  readonly message: string;
  readonly causes?: readonly { readonly name: string; readonly message: string }[];
} {
  if (!(error instanceof Error)) {
    return {
      name: 'NonErrorFailure',
      message: typeof error === 'string' ? redact(error) : 'Non-Error value thrown',
    };
  }
  const causes: { readonly name: string; readonly message: string }[] = [];
  const seen = new Set<Error>([error]);
  let cause = error.cause;
  while (cause instanceof Error && !seen.has(cause) && causes.length < 3) {
    seen.add(cause);
    causes.push({ name: redact(cause.name), message: redact(cause.message) });
    cause = cause.cause;
  }
  return {
    name: redact(error.name),
    message: redact(error.message),
    ...(causes.length > 0 ? { causes } : {}),
  };
}
