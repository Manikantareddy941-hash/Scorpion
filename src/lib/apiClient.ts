import { account } from './appwrite';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface ApiFetchOptions extends RequestInit {
    token?: string | null;
    retry?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function apiFetch(endpoint: string, options: ApiFetchOptions = {}) {
    let token = options.token;

    if (!token) {
        try {
            const data = await account.createJWT();
            token = data.jwt;
        } catch (e) {
            token = null;
        }
    }

    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
    const headers = new Headers(options.headers || {});

    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
        headers.set('Content-Type', 'application/json');
    }

    const { retry: shouldRetryOption, ...fetchOptions } = options;
    const isPost = options.method === 'POST';
    const canRetry = !isPost || shouldRetryOption === true;

    const backoffs = [0, 500, 1000];
    const maxRetries = 3;

    let lastError: any;
    let lastResponse: Response | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            await sleep(backoffs[attempt - 1]);
        }

        try {
            const response = await fetch(url, {
                ...fetchOptions,
                headers
            });
            lastResponse = response;

            if (!response.ok) {
                // Do not retry on these client errors
                if ([400, 401, 403, 404].includes(response.status)) {
                    break;
                }

                // Retry on server and gateway errors
                if ([500, 502, 503, 504].includes(response.status)) {
                    if (canRetry && attempt < maxRetries) {
                        continue;
                    }
                }

                // Break for other status codes or if out of retries
                break;
            }

            // Success response
            break;

        } catch (error: any) {
            lastError = error;

            // Immediately abort if the request was intentionally aborted
            if (error.name === 'AbortError') {
                throw error;
            }

            // Network error occurred
            if (canRetry && attempt < maxRetries) {
                continue;
            }
            break;
        }
    }

    if (lastResponse && !lastResponse.ok) {
        if (lastResponse.status === 401) {
            await account.deleteSession('current');
        }

        let message = 'Request failed';
        if (lastResponse.status === 401) message = 'Unauthorized';
        if (lastResponse.status === 403) message = 'Forbidden';
        if (lastResponse.status === 500) message = 'Server error';

        try {
            const data = await lastResponse.json();
            message = data.error || data.message || message;
        } catch (e) {
            // Keep default message from status
        }

        throw { message, status: lastResponse.status };
    }

    if (!lastResponse) {
        throw lastError || { message: 'Network error', status: 0 };
    }

    if (lastResponse.status === 204) {
        return null;
    }

    const contentType = lastResponse.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return await lastResponse.json();
    }

    if (contentType && contentType.includes('application/pdf')) {
        return await lastResponse.blob();
    }

    return lastResponse;
}
