package com.nimuairy.nimuairy.service;

/**
 * Internal to the auth flow: the controller puts the token into a cookie and returns only the
 * username, so the token never appears in a response body.
 */
public record AuthResult(String username, String token) {
}
