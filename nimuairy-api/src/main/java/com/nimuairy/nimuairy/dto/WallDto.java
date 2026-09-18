package com.nimuairy.nimuairy.dto;

import com.nimuairy.nimuairy.battle.PlayerSide;
import com.nimuairy.nimuairy.battle.Wall;

import java.util.List;

public record WallDto(
        String id,
        PlayerSide owner,
        PositionDto position,
        List<PositionDto> footprint,
        int health
) {

    public static WallDto from(Wall wall) {
        return new WallDto(
                wall.id(),
                wall.owner(),
                PositionDto.from(wall.position()),
                wall.footprint().offsets().stream().map(PositionDto::from).toList(),
                wall.health()
        );
    }
}
