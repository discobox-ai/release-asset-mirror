/**
 * A dependency outside this Worker failed, or answered in a way we cannot use.
 *
 * The top-level handler turns this into `status` and `message`, so the caller
 * is told what failed and whose fault it was. Anything else that escapes
 * `handle` is a bug in this Worker and stays an opaque 500.
 */
export class UpstreamError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}
