/** Thrown when an operation can't be applied without losing or distorting data. */
export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationError';
  }
}
