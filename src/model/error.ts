import statusDefaultMessage from '../services/statusDefaultMessage.json' with { type: 'json' };

export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;

    constructor(message: string, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

export class BadRequestError extends AppError {
    constructor(message = statusDefaultMessage["400"]) {
        super(message, 400);
    }
}

export class UnauthorizedError extends AppError {
    constructor(message = statusDefaultMessage["401"]) {
        super(message, 401);
    }
}

export class ForbiddenError extends AppError {
    constructor(message = statusDefaultMessage["403"]) {
        super(message, 403);
    }
}

export class NotFoundError extends AppError {
    constructor(message = statusDefaultMessage["404"]) {
        super(message, 404);
    }
}

export class RateLimitError extends AppError {
    constructor(message = statusDefaultMessage["429"]) {
        super(message, 429);
    }
}
