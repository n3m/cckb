# Idea: Knowledge Base for Claude-Code

## What is it?
- A 'per-project' installable Claude Code System for saving a sparse LLM documentation system, a.k.a Knowledge Base, about the project.
- It can either be installed into an already progressed project or in a new project.

## The idea
- A hooks/skills automatic system that will capture important information about the "lore" of each of the projects core-mechanics, entities and such.
- The system will capture all the information and indexes in a folder called "cc-knowledge-base"
- Doesn't need to have all the complete documentation up to the dot, but a general understanding, file structure, relations, and stuff that can help Claude to guide itself better.

## The Workflow Cycle

- Requirement:
  - The project root has a folder called "cc-knowledge-base"
    - Inside the folder we will have:
      - "/conversations" -- a directory for active conversations
        - "/conversations/{conversationUUID}" -- folder for an active conversation
        - "/conversations/{conversationUUID}/{compactIndexId}.txt" -- compactIndexID is meant to start on 0, to indicate that it is the start of the conversation without having been compacted; once compacted, the compactIndexID should + 1 to indicate compaction index.
      - "/vault" -- the core logic database main folder
        - "/vault/INDEX.md" -- the vault index of inner concepts
        - "/vault/architecture.md" -- the project practices and followed architectures

- The cycle:
  1. User starts new conversation (aka claude instance) -> a folder is created in "/conversations/{conversationUUID}" via hook/skill:[CreateConversation]
  2. User begins sending messages to Claude Code -> input is added to "/conversations/{conversationUUID}/0.txt" via hook/skill:[InputContextInserter]
  3. Claude begins sending output messages or asking questions -> output (without code) is added to "/conversations/{conversationUUID}/0.txt" via hook/skill:[OutputContextInserter]
  4. Repeat until conversation closed or until compaction
    4.1 If compaction, then "/conversations/{conversationUUID}/{starting index + compaction number}.txt" -> in our example it will be "/conversations/{conversationUUID}/1.txt"
    4.2 If conversation is closed, before closing a hook/skill:[CoreKnowledgeCompaction] will need to be run, that allows us to use the Claude Code CLI sdk to analyze the "/conversations/{conversationUUID}" folder in its entirety
      4.2.1 For each document, we will need to get the most relevant information that adds context to the core value of the project
      4.2.2 We will fill a "/conversations/summary.md" file with that information via a hook/skill:[ConversationIndexSummarizer] and reviews relevance or constitutes the a new summary with the added context.
      4.2.3 Repeat 4.2.1 until we run out of "{compactIndexId}.txt" files
      4.2.4 Once we're done, we will call a hook/skill:[KnowledgeIntegration] that will perform the next steps
  5. Hook/skill:[KnowledgeIntegration] will be in charge of taking the summary of the conversation and integrating it into the "/vault"

      The vault will work in some way like the following: 
        1. Imagine the user starts a new conversation/session on a NEW CLEAN Typescript project and says: "Create new entity with the following properties" 
        2. Then claude goes and does that
        3. Then the user goes "Now we will follow the 'Onion Architecture' and create a repository service and a usecase service with the base CRUD methods"
        4. The claude does that too
        5. The conversation is given the CLOSE signal
        6. our system does the whole summarization system
        7. the summary will look something like ():
        ```
          Entity: {NAMEOFENTITY}
          Type file: filePathTo/type.ts
          Follows Onion Architecture:
            - Repository file: @filePathTo/repository.ts
              - Available methods: CREATE, READ, UPDATE, DELETE
            - Usecase file: @filePathTo/usecase.ts
              - Available methods: CREATE, READ, UPDATE, DELETE
        ```
        8. The KnowledgeIntegration sees this and then first analyzes "/vault/INDEX.md" for an entity directory link, its not found, so:
          8.1: Creates folder "/entities" and inside the folder creates a different INDEX.md (/vault/entities/INDEX.md)
          8.2: Creates a folder for "/entities/NAMEOFENTITY", then inside of it creates an INDEX.md, attributes.md and services.md
          8.3: Inside "/entities/NAMEOFENTITY/attributes.md" adds a link to the file, and a short description/purpose of each attribute
          8.4: Inside "/entities/NAMEOFENTITY/services.md" adds context of the arquitecture for both services, the repository and the usecase, the location of the files and short descriptions of each.
            NOTE: this time, the services part didn't separate into more folders due to the limited information and not requiriming more.
          8.5: Inside the "/entities/NAMEOFENTITY/INDEX.md" adds a link to the services.md and attributes.md along a short (max 100~ chars) description of the contents of each file
          8.6: Inside "/entities/INDEX.md" (one folder up), adds a link to the folder of the entity and a short description or list of keywords of it.
          8.7: Inside "/vault/INDEX.md", adds a link to the "/vault/entities" folder
        9. Finishes updating the vault
        10. Finally closes the session

    6. DONE

  - This system is made to be highly adaptable, so it doesn't need to follow my conventions like I said, but it does need to have an INDEX.md per folder in the vault, so that CLAUDE can sparsely load only the data it needs without reading the entire knowledge base
  - Now, how are going to made CLAUDE aware of the vault and its contents? This is were we have to come up with something. Here's an idea I had:
    - For once, CLAUDE.md should have a clear directive of the /vault and what it does, giving the instruction that any doubts should be consultated with the information vault or if not found, directly with the user.
    - Then, I was thinking of something like "quibbler" (https://github.com/fulcrumresearch/quibbler), which is a system that adds a "coding agent that critiques claude codes actions" and is always running in the background, SO, we would take quibbler's concept and have a similar system running in the background, with the entire vault system indexes loaded and providing feedback to the main claude feedback via notifications made to it with hooks on user messages or claude's messages.
