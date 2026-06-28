package com.nimuairy.nimuairy.controller;

import com.nimuairy.nimuairy.dto.CharacterRequest;
import com.nimuairy.nimuairy.dto.CharacterResponse;
import com.nimuairy.nimuairy.service.CharacterService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/characters")
@RequiredArgsConstructor
public class CharacterController {

    private final CharacterService characterService;

    @GetMapping
    public List<CharacterResponse> getAll() {
        return characterService.findAll();
    }

    @GetMapping("/{id}")
    public CharacterResponse getById(@PathVariable Long id) {
        return characterService.findById(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CharacterResponse create(@Valid @RequestBody CharacterRequest request) {
        return characterService.create(request);
    }

    @PutMapping("/{id}")
    public CharacterResponse update(@PathVariable Long id, @Valid @RequestBody CharacterRequest request) {
        return characterService.update(id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        characterService.delete(id);
    }
}
