package com.nimuairy.nimuairy.controller;

import com.nimuairy.nimuairy.battle.BattleState;
import com.nimuairy.nimuairy.battle.Board;
import com.nimuairy.nimuairy.battle.Footprint;
import com.nimuairy.nimuairy.battle.Orb;
import com.nimuairy.nimuairy.battle.PlayerSide;
import com.nimuairy.nimuairy.battle.Position;
import com.nimuairy.nimuairy.battle.Terrain;
import com.nimuairy.nimuairy.battle.TerrainType;
import com.nimuairy.nimuairy.battle.Unit;
import com.nimuairy.nimuairy.battle.UnitType;
import com.nimuairy.nimuairy.battle.Wall;
import com.nimuairy.nimuairy.security.CustomUserDetailsService;
import com.nimuairy.nimuairy.security.JwtService;
import com.nimuairy.nimuairy.service.BattleService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(BattleController.class)
@AutoConfigureMockMvc(addFilters = false)
class BattleControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private BattleService battleService;

    // @WebMvcTest also instantiates JwtAuthenticationFilter (it is a Filter bean); its
    // dependencies must be satisfied even though addFilters = false skips applying it.
    @MockitoBean
    private JwtService jwtService;

    @MockitoBean
    private CustomUserDetailsService userDetailsService;

    @Test
    void getDemoBattle_returnsContractShapedJson() throws Exception {
        Footprint unitFootprint = new Footprint(List.of(new Position(0, 0)));
        BattleState battleState = new BattleState(
                new Board(21, 11, List.of(new Terrain(new Position(0, 0), TerrainType.PLAIN))),
                List.of(new Orb("orb-left", PlayerSide.LEFT, new Position(0, 5), unitFootprint, 75)),
                List.of(new Wall("wall-left", PlayerSide.LEFT, new Position(1, 0), unitFootprint, 1500)),
                List.of(new Unit("unit-left-1", PlayerSide.LEFT, UnitType.SWORDSMAN, new Position(3, 2),
                        unitFootprint, 500, 200, 50, 3))
        );
        when(battleService.getDemoBattle()).thenReturn(battleState);

        mockMvc.perform(get("/api/v1/battles/demo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.board.width").value(21))
                .andExpect(jsonPath("$.board.height").value(11))
                .andExpect(jsonPath("$.board.terrain[0].type").value("PLAIN"))
                .andExpect(jsonPath("$.orbs[0].id").value("orb-left"))
                .andExpect(jsonPath("$.orbs[0].owner").value("LEFT"))
                .andExpect(jsonPath("$.orbs[0].position.x").value(0))
                .andExpect(jsonPath("$.orbs[0].position.y").value(5))
                .andExpect(jsonPath("$.walls[0].id").value("wall-left"))
                .andExpect(jsonPath("$.walls[0].health").value(1500))
                .andExpect(jsonPath("$.units[0].id").value("unit-left-1"))
                .andExpect(jsonPath("$.units[0].unitType").value("SWORDSMAN"))
                .andExpect(jsonPath("$.units[0].moveRange").value(3))
                .andExpect(jsonPath("$.leftPlayer").doesNotExist())
                .andExpect(jsonPath("$.rightPlayer").doesNotExist());
    }
}
