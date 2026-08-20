"""Unit tests for the Library vault's pure logic — link parsing + excerpts.
These never touch Postgres; the DB-backed CRUD is covered by manual/live checks."""
import pytest

from app.services import notes_svc


# ---------- _parse_links ----------

@pytest.mark.unit
def test_parse_links_extracts_wikilinks():
    assert notes_svc._parse_links("see [[Alpha]] and [[Beta]]") == ["Alpha", "Beta"]


@pytest.mark.unit
def test_parse_links_dedupes_case_insensitively_keeping_first():
    assert notes_svc._parse_links("[[Note]] then [[note]] again [[NOTE]]") == ["Note"]


@pytest.mark.unit
def test_parse_links_trims_and_ignores_empty():
    assert notes_svc._parse_links("[[  Spaced Title  ]]") == ["Spaced Title"]
    assert notes_svc._parse_links("no links here") == []
    assert notes_svc._parse_links("") == []


@pytest.mark.unit
def test_parse_links_does_not_match_single_brackets_or_newlines():
    assert notes_svc._parse_links("[not a link] and [[broken\nlink]]") == []


# ---------- _excerpt ----------

@pytest.mark.unit
def test_excerpt_unwraps_wikilinks_and_strips_markdown():
    out = notes_svc._excerpt("# Heading\n[[Ablations]] is **bold** and `code`")
    assert "[[" not in out and "]]" not in out
    assert "#" not in out and "*" not in out and "`" not in out
    assert "Ablations" in out and "Heading" in out and "bold" in out


@pytest.mark.unit
def test_excerpt_collapses_whitespace_and_truncates():
    out = notes_svc._excerpt("word   " * 100, n=40)
    assert len(out) <= 40
    assert "  " not in out


@pytest.mark.unit
def test_excerpt_handles_empty():
    assert notes_svc._excerpt("") == ""
    assert notes_svc._excerpt(None) == ""
