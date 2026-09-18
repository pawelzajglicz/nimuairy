package com.nimuairy.nimuairy.controller;

import com.nimuairy.nimuairy.dto.BattleStateResponse;
import com.nimuairy.nimuairy.service.BattleService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/battles")
@RequiredArgsConstructor
public class BattleController {

    private final BattleService battleService;

    @GetMapping("/demo")
    public BattleStateResponse getDemoBattle() {
        return BattleStateResponse.from(battleService.getDemoBattle());
    }
}
