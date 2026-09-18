package com.nimuairy.nimuairy.dto;

import com.nimuairy.nimuairy.battle.Position;

public record PositionDto(int x, int y) {

    public static PositionDto from(Position position) {
        return new PositionDto(position.x(), position.y());
    }
}
