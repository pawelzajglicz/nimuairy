package com.nimuairy.nimuairy.service;

import com.nimuairy.nimuairy.dto.CharacterRequest;
import com.nimuairy.nimuairy.dto.CharacterResponse;
import com.nimuairy.nimuairy.exception.ResourceNotFoundException;
import com.nimuairy.nimuairy.model.Character;
import com.nimuairy.nimuairy.repository.CharacterRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class CharacterService {

    private final CharacterRepository characterRepository;

    @Transactional(readOnly = true)
    public List<CharacterResponse> findAll() {
        return characterRepository.findAll().stream()
                .map(CharacterResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public CharacterResponse findById(Long id) {
        return CharacterResponse.from(getCharacter(id));
    }

    @Transactional
    public CharacterResponse create(CharacterRequest request) {
        Character character = Character.builder()
                .name(request.getName())
                .description(request.getDescription())
                .build();

        return CharacterResponse.from(characterRepository.save(character));
    }

    @Transactional
    public CharacterResponse update(Long id, CharacterRequest request) {
        Character character = getCharacter(id);
        character.setName(request.getName());
        character.setDescription(request.getDescription());

        return CharacterResponse.from(characterRepository.save(character));
    }

    @Transactional
    public void delete(Long id) {
        Character character = getCharacter(id);
        characterRepository.delete(character);
    }

    private Character getCharacter(Long id) {
        return characterRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Character not found: " + id));
    }
}
