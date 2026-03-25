import pytest
from django.test import Client


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def api_client():
    """Client with JSON content type default."""
    return Client(content_type="application/json")
