import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSiteUrl, ValidationError } from "../src/validate.js";

test("parseSiteUrl: accepts a bare domain and defaults to https", () => {
  assert.equal(parseSiteUrl("example.com"), "https://example.com/");
});

test("parseSiteUrl: accepts a full https URL unchanged (modulo normalization)", () => {
  assert.equal(parseSiteUrl("https://example.com/page"), "https://example.com/page");
});

test("parseSiteUrl: accepts http", () => {
  assert.equal(parseSiteUrl("http://example.com"), "http://example.com/");
});

test("parseSiteUrl: treats localhost:3000 as host:port, not a scheme", () => {
  assert.equal(parseSiteUrl("localhost:3000"), "https://localhost:3000/");
});

test("parseSiteUrl: rejects non-http(s) schemes", () => {
  assert.throws(() => parseSiteUrl("ftp://example.com"), ValidationError);
  assert.throws(() => parseSiteUrl("javascript:alert(1)"), ValidationError);
});

test("parseSiteUrl: rejects unparseable input", () => {
  assert.throws(() => parseSiteUrl("not a valid url"), ValidationError);
});

test("parseSiteUrl: rejects an empty string", () => {
  assert.throws(() => parseSiteUrl(""), ValidationError);
});
