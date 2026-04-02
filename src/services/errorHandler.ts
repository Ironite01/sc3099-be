import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import statusDefaultMessage from './statusDefaultMessage.json' with { type: 'json' };
import { AppError } from '../model/error.js';

type ValidationIssue = {
    instancePath: string;
    keyword: string;
    message?: string;
    params: Record<string, any>;
};

function buildValidationLoc(issue: ValidationIssue, context: string) {
    const loc = [context];
    const pointer = issue.instancePath || "";

    if (pointer.length > 0) {
        const segments = pointer
            .split('/')
            .filter(Boolean)
            .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
        loc.push(...segments);
    }

    if (issue.keyword === "required" && issue.params?.missingProperty) {
        loc.push(issue.params.missingProperty);
    }

    return loc;
}

function buildValidationType(issue: ValidationIssue) {
    if (issue.keyword === "format" && issue.params?.format) {
        return `value_error.${issue.params.format}`;
    }
    return `value_error.${issue.keyword}`;
}

function validation(fastify: FastifyInstance) {
    fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
        if (error.validation) {
            const context = error.validationContext || "body";
            const detail = (error.validation as ValidationIssue[]).map((issue) => ({
                loc: buildValidationLoc(issue, context),
                msg: issue.message || "Invalid input",
                type: buildValidationType(issue)
            }));
            return reply.status(422).send({
                statusCode: 422,
                error: 'Validation Error',
                message: 'Validation Error',
                detail
            });
        }

        const isKnownAppError = error instanceof AppError;
        const statusCode = isKnownAppError
            ? error.statusCode
            : (error.statusCode && error.statusCode >= 400 ? error.statusCode : 500);
        const detail = isKnownAppError
            ? (error.message || statusDefaultMessage[String(statusCode) as keyof typeof statusDefaultMessage])
            : statusDefaultMessage["500"];
        request.log.error(error);
        reply.status(statusCode).send({
            statusCode,
            error: statusDefaultMessage[String(statusCode) as keyof typeof statusDefaultMessage] || 'Error',
            message: detail,
            detail
        });
    });
}

export default fp(validation);
