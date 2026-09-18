package com.nimuairy.nimuairy.dto;

import com.nimuairy.nimuairy.battle.Terrain;
import com.nimuairy.nimuairy.battle.TerrainType;

public record TerrainCellDto(PositionDto position, TerrainType type) {

    public static TerrainCellDto from(Terrain terrain) {
        return new TerrainCellDto(PositionDto.from(terrain.position()), terrain.type());
    }
}
