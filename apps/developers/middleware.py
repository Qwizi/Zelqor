class RateLimitHeadersMiddleware:
    """Attach X-RateLimit-* headers to responses for API key authenticated requests."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        rate_info = getattr(request, 'rate_limit_info', None)
        if rate_info:
            response['X-RateLimit-Limit'] = str(rate_info['limit'])
            response['X-RateLimit-Remaining'] = str(rate_info['remaining'])
            response['X-RateLimit-Reset'] = str(rate_info['reset'])

        return response
