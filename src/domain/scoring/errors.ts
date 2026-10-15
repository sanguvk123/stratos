/** Thrown when scoring is asked to work on inputs that violate a documented precondition. */
export class ScoringInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoringInputError';
  }
}

export function assertNonNegativeSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ScoringInputError(`${name} must be a non-negative safe integer, got ${value}`);
  }
}

export function assertPositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ScoringInputError(`${name} must be a positive safe integer, got ${value}`);
  }
}
