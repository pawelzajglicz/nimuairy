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

## Battle system

### Current prototype phase

The backend does not execute battle rules yet.

For the current prototype:

- Provide a hard-coded initial `BattleState` through the REST API.
- Do not add database persistence for battle state.
- Do not implement battle actions on the backend yet.
- Do not add WebSocket or multiplayer support.
- Keep the API contract independent from future persistence details.

The demo battle should contain:

- the board definition,
- one orb,
- walls,
- four units for each player,
- unit type,
- HP,
- defense,
- attack,
- player ownership,
- position.

The initial state may be hard-coded in a service.

### Future battle engine

The future authoritative battle engine will live in plain Java:

    (state, action) -> state

It must not depend on Spring or JPA.

Services will later be responsible for:

- loading the battle,
- validating permissions,
- passing the action to the battle engine,
- persisting the resulting state,
- returning the result to the clients.

The backend will eventually become authoritative for all battle rules.

## My preferences

<!-- Style, package-by-layer vs package-by-feature, DTO↔entity mapping approach,
     error response shape, test naming. -->
