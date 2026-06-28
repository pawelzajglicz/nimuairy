package com.nimuairy.nimuairy.repository;

import com.nimuairy.nimuairy.model.Character;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CharacterRepository extends JpaRepository<Character, Long> {
}
