package com.nimuairy.nimuairy.dto;

import com.nimuairy.nimuairy.battle.Orb;
import com.nimuairy.nimuairy.battle.PlayerSide;

import java.util.List;

public record OrbDto(
        String id,
        PlayerSide owner,
        PositionDto position,
        List<PositionDto> footprint,
        int health
) {

    public static OrbDto from(Orb orb) {
        return new OrbDto(
                orb.id(),
                orb.owner(),
                PositionDto.from(orb.position()),
                orb.footprint().offsets().stream().map(PositionDto::from).toList(),
                orb.health()
        );
    }
}
