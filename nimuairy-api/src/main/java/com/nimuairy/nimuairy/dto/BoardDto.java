package com.nimuairy.nimuairy.dto;

import com.nimuairy.nimuairy.battle.Board;

import java.util.List;

public record BoardDto(int width, int height, List<TerrainCellDto> terrain) {

    public static BoardDto from(Board board) {
        return new BoardDto(
                board.width(),
                board.height(),
                board.terrain().stream().map(TerrainCellDto::from).toList()
        );
    }
}
