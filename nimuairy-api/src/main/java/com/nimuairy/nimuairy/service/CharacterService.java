package com.nimuairy.nimuairy.service;

import com.nimuairy.nimuairy.dto.CharacterRequest;
import com.nimuairy.nimuairy.dto.CharacterResponse;
import com.nimuairy.nimuairy.exception.ResourceNotFoundException;
import com.nimuairy.nimuairy.model.Character;
import com.nimuairy.nimuairy.repository.CharacterRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CharacterService {

    private final CharacterRepository characterRepository;

    @Transactional(readOnly = true)
    public Page<CharacterResponse> findAll(Pageable pageable) {
        return characterRepository.findAll(pageable)
                .map(CharacterResponse::from);
    }

    @Transactional(readOnly = true)
    public CharacterResponse findById(Long id) {
        return CharacterResponse.from(getCharacter(id));
    }

    @Transactional
    public CharacterResponse create(CharacterRequest request) {
        Character character = Character.builder()
                .name(request.name())
                .description(request.description())
                .build();

        return CharacterResponse.from(characterRepository.save(character));
    }

    @Transactional
    public CharacterResponse update(Long id, CharacterRequest request) {
        Character character = getCharacter(id);
        character.setName(request.name());
        character.setDescription(request.description());

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
