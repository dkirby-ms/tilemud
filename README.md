# tilemud

Minimal README for the tilemud project.

## Overview
Tilemud is a small project that implements tile-based logic and related tooling. This repository uses spec-kit for writing specifications and the `specify` runner to execute them.


## Specification-driven development

[Speckit](https://github.com/github/spec-kit) is used to develop this game. Adding new features should follow this specification-driven process.

    ```
    /specify I want a web app that allows users to login to the site, and then create a character that persists over subsequent logins. The user can select a name and character archetype. I already have an Entra ID external identities tenant setup for oauth with an app registration and userflow.
    ```

Use Copilot to complete the specification, addressing any areas that need clarification 

    ```
    /plan React frontend with static content for now - no databases connection required for now - data is embedded in content for mock character creation. Site is responsive and ready for mobile. 
    ```

Review the plan and other content and adjust as needed either by editing the markdown directly or through Copilot prompts.

    ```
    /tasks Build out the tasks needed.
    ```

Review the tasks list and edit as needed. Now you can proceed with using a coding agent to actually implement the tasks. Prompt the LLM to implement the tasks and "allow" commands as needed to proceed through development. Occassionally, you may need to run ```/tasks``` again to update progress.

    ```
    /tasks Update the tasks list to reflect completed tasks
    ```

## Contributing
Open issues or PRs with a clear description and tests/specs where applicable.

## License
Add a license file (e.g., MIT) and reference it here.

Contact: maintainers listed in the repository.