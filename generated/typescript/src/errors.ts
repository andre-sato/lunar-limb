// Gerado. Não edite à mão.

/** Erro devolvido pela API, com o código e o corpo preservados. */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly statusCode: number,
		readonly response: unknown
	) {
		super(message);
		this.name = new.target.name;
	}
}

/** 400 e 422. */
export class ValidationError extends ApiError {}
/** 401 e 403. */
export class UnauthorizedError extends ApiError {}
/** 404. */
export class NotFoundError extends ApiError {}
/** 429. */
export class RateLimitError extends ApiError {}
/** 5xx. */
export class ServerError extends ApiError {}
