package com.nimuairy.nimuairy.battle;

/**
 * The HP invariant shared by units, walls and orbs: {@code 0 <= health <= maxHealth}, with a
 * positive maximum. {@code maxHealth} is kept apart from {@code health} because the maximum
 * cannot be recovered from the current value once an object has taken damage.
 */
final class Health {

    private Health() {
    }

    static void validate(int health, int maxHealth) {
        if (maxHealth <= 0) {
            throw new IllegalArgumentException("maxHealth must be positive: " + maxHealth);
        }
        if (health < 0 || health > maxHealth) {
            throw new IllegalArgumentException(
                    "health must be between 0 and maxHealth " + maxHealth + ": " + health);
        }
    }
}
