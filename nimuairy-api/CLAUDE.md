# Backend — nimuairy-api

Spring Boot 4.1, Java 25. Runs on :8000 under `/api`. Needs the `dev` profile:
`./mvnw spring-boot:run -Dspring-boot.run.profiles=dev`. Swagger at `/swagger-ui.html`.

## Conventions here

- Layering is strict: Controller → Service → Repository. Controllers map HTTP and delegate;
  services hold the rules and `@Transactional`. **Entities never leave the service layer.**
- `private final` fields + `@RequiredArgsConstructor`. No `@Autowired` field injection.
- Separate `XRequest` (validated with `@Valid`) and `XResponse` DTOs, as records.
- Collections return `Page<T>` and accept `Pageable`.
- Services throw `ResourceNotFoundException` / `ConflictException`; `GlobalExceptionHandler`
  turns them into responses. Controllers never build error bodies.
- Schema changes = a new numbered Liquibase changelog registered in `changelog-master.xml`.
  `ddl-auto: validate`, so entity and schema must agree. Never edit an applied changeset.
- Stateless JWT; `SecurityConfig` lists the public paths.

## Recommendations

- Avoid `@Data` on JPA entities — generated `equals`/`hashCode`/`toString` touch lazy
  associations and cause surprise queries or stack overflows on bidirectional relations.
- `FetchType.LAZY` on associations; fetch what you need with an explicit join. Main N+1 source.
- `readOnly = true` on query transactions.
- Client-facing error messages describe what went wrong, not which class threw.
- Mockito for services, `@WebMvcTest` for controller contracts, `@SpringBootTest` sparingly.
- Java 25: records, sealed interfaces, pattern matching in `switch`, text blocks.

## Battle engine (when I build it)

Keep the rules in plain Java — pure `(state, action) -> state`, no Spring or JPA. Easy to
unit-test, and it's where the game actually lives. Services wrap it with loading, persisting
and permission checks. Sealed interface for action types so `switch` stays exhaustive.
Validate every request server-side: is it that character's turn, is the action legal, is the
battle still open, has this turn already been applied.

## My preferences

<!-- Style, package-by-layer vs package-by-feature, DTO↔entity mapping approach,
     error response shape, test naming. -->
