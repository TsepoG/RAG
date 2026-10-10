# MCP tools

Generated 2026-10-10T15:20:32.184Z by `npm run mcp:tools`. Do not edit by hand; run it again to refresh.

A tool is classed "read" only when its name has no write verb and the server does not mark it
destructive or not read-only. The allow-lists in `src/mcp/allowlist.js` are a hand-reviewed
subset of the read tools below. The GitHub server is asked for read-only tools, so it lists
no write tools at all.

## atlassian

URL: https://mcp.atlassian.com/v2/mcp

21 tools: 12 read, 9 write.

| Tool | Class | Why | Description |
| --- | --- | --- | --- |
| `addGraphContext` | write | name contains the write verb "add" | Adds a relationship between two entities in the Teamwork Graph (e.g. linking two Jira work items, marking one as blocking another, attaching a remote link, or… |
| `addOrEditJiraIssueComment` | write | name contains the write verb "add" | Add a comment to a Jira issue, or edit an existing one: omit commentId to add, or pass one from listJiraIssueComments to edit. Returns the commentId, needed to… |
| `atlassianUserInfo` | read | no write verb in the name | Returns the accountId of the current user |
| `createConfluenceContent` | write | name contains the write verb "create" | Create a new Confluence page, blog post, live doc, whiteboard, database, embed, smart link, or folder. Before choosing body.format or authoring a body, call ge… |
| `createJiraIssue` | write | name contains the write verb "create" | Create a new Jira issue. Custom fields go in additional_fields: keyed by field name, values are resolved automatically, so no field lookup is needed first (use… |
| `discover` | read | no write verb in the name | Find Atlassian operations that are not already in your tool list. Searches ~319 operations across Jira, Confluence, Compass, Bitbucket, Focus, Goals, Projects,… |
| `editJiraIssue` | write | name contains the write verb "edit" | Edit an existing Jira issue. Custom fields go in additional_fields: keyed by field name, values are resolved automatically (user fields take accountIds); keyed… |
| `executeDestructive` | write | server marks it destructive | Run a destructive Atlassian operation by name (deletes or irreversibly changes data) across all Atlassian products. Only use an operation name from discover re… |
| `executeRead` | read | no write verb in the name | Run a read-only Atlassian operation by name across all Atlassian products. Only use an operation name from discover results or one already in your tool list; n… |
| `executeWrite` | write | name contains the write verb "write" | Run a write Atlassian operation by name (creates or updates data, non-destructive) across all Atlassian products. Only use an operation name from discover resu… |
| `getAccessibleAtlassianResources` | read | no write verb in the name | Returns the cloudId(s) available to the current user |
| `getConfluenceContent` | read | no write verb in the name | REQUIRED: Supply at least one content locator: content_id or content_url. Read any Confluence content (page, blog, live doc, comment, whiteboard, embed, databa… |
| `getGraphContext` | read | no write verb in the name | Retrieves connected context from Teamwork Graph for any Atlassian entity. Returns all relationships and linked objects within one traversal – including cross-p… |
| `getGraphObject` | read | no write verb in the name | Fetches the entire available data for one or more objects (Atlassian or third-party) using their ARIs or URLs. Use for the objects gathered from getGraphContex… |
| `getJiraIssue` | read | no write verb in the name | Get a Jira or JSM issue by key or ID. Use for one known issue; use searchJiraIssuesUsingJql to find or list many issues. Reports how many comments an issue has… |
| `getLoomVideo` | read | no write verb in the name | Reads a Loom video's core metadata and optionally its transcript, comments, AI agent briefs, AI-extracted meeting action items, or attached links in one call v… |
| `search` | read | no write verb in the name | Semantically search Jira, Confluence, and connected third-party content using Rovo Search. ALWAYS use this tool to search for Jira and Confluence content unles… |
| `searchConfluence` | read | no write verb in the name | Search Confluence content with CQL |
| `searchJiraIssuesUsingJql` | read | no write verb in the name | Search for Jira issues using JQL, with an optional approximate count. Use view: "evidence" to fetch and map custom fields. Page with nextPageToken until isLast… |
| `transitionJiraIssue` | write | server does not mark it read-only | Move a Jira issue through its workflow and/or into a sprint or the backlog — at least one is required. Take transitionId from listJiraIssueTransitions; transit… |
| `updateConfluenceContent` | write | name contains the write verb "update" | Update Confluence docs, whiteboards, or databases. Before choosing body.format or authoring an edit, call getContentFormatGuide through execute with name=getCo… |

## github_repos

URL: https://api.githubcopilot.com/mcp/

13 tools: 13 read, 0 write.

| Tool | Class | Why | Description |
| --- | --- | --- | --- |
| `get_commit` | read | no write verb in the name | Get details for a commit from a GitHub repository |
| `get_file_contents` | read | no write verb in the name | Get the contents of a file or directory from a GitHub repository |
| `get_latest_release` | read | no write verb in the name | Get the latest release in a GitHub repository |
| `get_release_by_tag` | read | no write verb in the name | Get a specific release by its tag name in a GitHub repository |
| `get_tag` | read | no write verb in the name | Get details about a specific git tag in a GitHub repository |
| `list_branches` | read | no write verb in the name | List branches in a GitHub repository |
| `list_commits` | read | no write verb in the name | Get list of commits of a branch in a GitHub repository. Returns at least 30 results per page by default, but can return more if specified using the perPage par… |
| `list_releases` | read | no write verb in the name | List releases in a GitHub repository |
| `list_repository_collaborators` | read | no write verb in the name | List collaborators of a GitHub repository. Results are paginated; the response includes `nextPage`, `prevPage`, `firstPage`, and `lastPage` fields. To get the… |
| `list_tags` | read | no write verb in the name | List git tags in a GitHub repository |
| `search_code` | read | no write verb in the name | Fast and precise code search across ALL GitHub repositories using GitHub's native search engine. Best for finding exact symbols, functions, classes, or specifi… |
| `search_commits` | read | no write verb in the name | Search for commits across GitHub repositories using GitHub's commit search syntax. Useful for finding specific changes, authors, or messages across one or many… |
| `search_repositories` | read | no write verb in the name | Find GitHub repositories by name, description, readme, topics, or other metadata. Perfect for discovering projects, finding examples, or locating specific repo… |
