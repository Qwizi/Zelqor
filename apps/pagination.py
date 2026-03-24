from django.db.models import QuerySet

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def paginate_qs(qs: QuerySet, limit: int = DEFAULT_LIMIT, offset: int = 0, schema=None) -> dict:
    """Manual pagination for ninja_extra controllers.

    Returns {"items": [...], "count": N} with efficient COUNT + LIMIT/OFFSET.
    If schema is provided, each item is validated through it for proper serialization.
    """
    limit = max(1, min(limit, MAX_LIMIT))
    offset = max(0, offset)
    count = qs.count()
    items = list(qs[offset : offset + limit])
    if schema is not None:
        items = [schema.from_orm(item).dict() for item in items]
    return {"items": items, "count": count}
