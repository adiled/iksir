/**
 * Linear GraphQL API Client
 *
 * Direct GraphQL client for Linear API operations.
 * Handles ticket management, project queries, and status updates.
 */

import { logger } from "../logging/logger.ts";
import type {
  TasmimIksir,
  MutabiWasfa,
  WasfaMutaba,
  MashruMutabi,
  MaalimMutabi,
  RabitWasfaMuhallal,
  MudkhalKhalqQadiya,
  MudkhalTahdithQadiya,
  MurashihatQadiya,
  NawKiyan,
} from "../types.ts";
import { LINEAR_API_BASE } from "../constants.ts";

const LINEAR_API_URL = `${LINEAR_API_BASE}/graphql`;


interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string; type: string };
  estimate: number | null;
  awwaliyya: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  parent: { id: string; identifier: string; title: string } | null;
  children: { nodes: Array<{ id: string; identifier: string }> };
  relations: {
    nodes: Array<{
      type: string;
      relatedIssue: { id: string; identifier: string };
    }>;
  };
  labels: { nodes: Array<{ name: string }> };
  assignee: { id: string; name: string; email: string } | null;
  project: { id: string; name: string } | null;
  attachments: { nodes: Array<{ url: string; title: string }> };
}

interface LinearProject {
  id: string;
  name: string;
  description: string | null;
  state: string;
  url: string;
  issues: { nodes: LinearIssue[] };
}

interface LinearTeam {
  id: string;
  name: string;
  key: string;
  states: { nodes: Array<{ id: string; name: string; type: string }> };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
}


export class LinearClient implements MutabiWasfa {
  readonly provider = "linear";
  private apiKey: string;
  private teamId: string;
  private stateCache: Map<string, { id: string; name: string; type: string }> = new Map();

  constructor(config: TasmimIksir) {
    this.apiKey = config.mutabiWasfa.miftahApi;
    this.teamId = config.mutabiWasfa.huwiyyatFareeq;
  }

  /**
   * Execute a GraphQL query
   */
  private async query<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T | null> {
    try {
      const response = await fetch(LINEAR_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        await logger.sajjalKhata("linear", `HTTP error: ${response.status}`, {
          statusText: response.statusText,
        });
        return null;
      }

      const result = (await response.json()) as GraphQLResponse<T>;

      if (result.errors && result.errors.length > 0) {
        await logger.sajjalKhata("linear", "GraphQL errors", {
          errors: result.errors.map((e) => e.message),
        });
        return null;
      }

      return result.data ?? null;
    } catch (error) {
      await logger.sajjalKhata("linear", "Query failed", { error: String(error) });
      return null;
    }
  }

  /**
   * Check if the API key is valid
   */
  async isAuthenticated(): Promise<boolean> {
    const result = await this.query<{ viewer: { id: string } }>(`
      query { viewer { id } }
    `);
    return result?.viewer?.id !== undefined;
  }

  /**
   * Get current user info
   */
  async getCurrentUser(): Promise<{ id: string; name: string; email: string } | null> {
    const result = await this.query<{
      viewer: { id: string; name: string; email: string };
    }>(`
      query {
        viewer { id name email }
      }
    `);
    return result?.viewer ?? null;
  }


  /**
   * Get team info and cache workflow states
   */
  async getTeam(): Promise<LinearTeam | null> {
    const result = await this.query<{ team: LinearTeam }>(
      `
      query($teamId: String!) {
        team(id: $teamId) {
          id
          name
          key
          states {
            nodes { id name type }
          }
        }
      }
    `,
      { teamId: this.teamId }
    );

    if (result?.team) {
      for (const state of result.team.states.nodes) {
        this.stateCache.set(state.name.toLowerCase(), state);
      }
    }

    return result?.team ?? null;
  }

  /**
   * Get workflow state ID by name
   */
  async getStateId(stateName: string): Promise<string | null> {
    /** Check cache first */
    const cached = this.stateCache.get(stateName.toLowerCase());
    if (cached) return cached.id;

    await this.getTeam();

    const state = this.stateCache.get(stateName.toLowerCase());
    return state?.id ?? null;
  }


  private readonly issueFragment = `
    fragment IssueFields on Issue {
      id
      identifier
      title
      description
      state { name type }
      estimate
      awwaliyya
      url
      createdAt
      updatedAt
      parent { id identifier title }
      children { nodes { id identifier } }
      relations {
        nodes {
          type
          relatedIssue { id identifier }
        }
      }
      labels { nodes { name } }
      assignee { id name email }
      project { id name }
      attachments { nodes { url title } }
    }
  `;

  /**
   * Get issue by identifier (e.g., "TEAM-200")
   */
  async getIssue(identifier: string): Promise<WasfaMutaba | null> {
    const issue = await this.getLinearIssue(identifier);
    return issue ? this.toWasfaMutaba(issue) : null;
  }

  /**
   * Get raw Linear issue by identifier (internal use)
   */
  async getLinearIssue(identifier: string): Promise<LinearIssue | null> {
    const result = await this.query<{ issue: LinearIssue }>(
      `
      ${this.issueFragment}
      query($identifier: String!) {
        issue(id: $identifier) {
          ...IssueFields
        }
      }
    `,
      { identifier }
    );

    return result?.issue ?? null;
  }

  /**
   * Get issue by UUID
   */
  async getIssueById(id: string): Promise<LinearIssue | null> {
    const result = await this.query<{ issue: LinearIssue }>(
      `
      ${this.issueFragment}
      query($id: String!) {
        issue(id: $id) {
          ...IssueFields
        }
      }
    `,
      { id }
    );

    return result?.issue ?? null;
  }

  /**
   * Search issues by text
   */
  async searchIssues(searchTerm: string, limit: number = 20): Promise<WasfaMutaba[]> {
    /** searchIssues returns IssueSearchResult which has a subset of fields */
    const result = await this.query<{
       searchIssues: {
        nodes: Array<{
          id: string;
          identifier: string;
          title: string;
          description: string | null;
          state: { name: string; type: string };
          estimate: number | null;
          awwaliyya: number;
          url: string;
          parent: { id: string; identifier: string; title: string } | null;
          children: { nodes: Array<{ id: string; identifier: string }> };
          labels: { nodes: Array<{ name: string }> };
        }>;
      };
    }>(
      `
      query($term: String!, $first: Int!) {
        searchIssues(term: $term, first: $first) {
          nodes {
            id
            identifier
            title
            description
            state { name type }
            estimate
            awwaliyya
            url
            parent { id identifier title }
            children { nodes { id identifier } }
            labels { nodes { name } }
          }
        }
      }
    `,
      { term: searchTerm, first: limit }
    );

    return (result?.searchIssues?.nodes ?? []).map((node) => this.toWasfaMutaba({
      ...node,
      createdAt: "",
      updatedAt: "",
      relations: { nodes: [] },
      assignee: null,
      project: null,
      attachments: { nodes: [] },
    }));
  }

  /**
   * Get issues with filters (assignee, status, cycle)
   */
  async getFilteredIssues(filters: MurashihatQadiya, limit: number = 20): Promise<WasfaMutaba[]> {
    /** Build filter object */
    const filterParts: string[] = [];
    const variables: Record<string, unknown> = { first: limit };

    filterParts.push(`team: { key: { eq: "${this.teamId}" } }`);

    if (filters.assigneeId) {
      filterParts.push("assignee: { isMe: { eq: true } }");
    }

    if (filters.status) {
      const stateTypeMap: Record<string, string> = {
        backlog: "backlog",
        todo: "unstarted",
        in_progress: "started",
        done: "completed",
      };
      const stateType = stateTypeMap[filters.status];
      if (stateType) {
        filterParts.push(`state: { type: { eq: "${stateType}" } }`);
      }
    }

    if (filters.cycleId) {
      filterParts.push(`cycle: { id: { eq: "${filters.cycleId}" } }`);
    }

    const filterString = filterParts.length > 0 ? `filter: { ${filterParts.join(", ")} }` : "";

    const result = await this.query<{
      issues: {
        nodes: Array<{
          id: string;
          identifier: string;
          title: string;
          description: string | null;
          state: { name: string; type: string };
          estimate: number | null;
          awwaliyya: number;
          url: string;
          parent: { id: string; identifier: string; title: string } | null;
          children: { nodes: Array<{ id: string; identifier: string }> };
          labels: { nodes: Array<{ name: string }> };
        }>;
      };
    }>(
      `
      query($first: Int!) {
        issues(${filterString}, first: $first) {
          nodes {
            id
            identifier
            title
            description
            state { name type }
            estimate
            awwaliyya
            url
            parent { id identifier title }
            children { nodes { id identifier } }
            labels { nodes { name } }
          }
        }
      }
    `,
      variables
    );

    return (result?.issues?.nodes ?? []).map((node) => this.toWasfaMutaba({
      ...node,
      createdAt: "",
      updatedAt: "",
      relations: { nodes: [] },
      assignee: null,
      project: null,
      attachments: { nodes: [] },
    }));
  }

  /**
   * Get current active cycle for the team
   */
  async getCurrentCycle(): Promise<{ id: string; name: string; number: number } | null> {
    const result = await this.query<{
      cycles: {
        nodes: Array<{
          id: string;
          name: string;
          number: number;
          startsAt: string;
          endsAt: string;
        }>;
      };
    }>(
      `
      query($teamKey: String!) {
        cycles(filter: { 
          team: { key: { eq: $teamKey } },
          yakunuFail: { eq: true }
        }, first: 1) {
          nodes {
            id
            name
            number
            startsAt
            endsAt
          }
        }
      }
    `,
      { teamKey: this.teamId }
    );

    return result?.cycles?.nodes?.[0] ?? null;
  }

  /**
   * Get issues in a project
   */
  async getProjectIssues(projectId: string): Promise<LinearIssue[]> {
    const result = await this.query<{ project: { issues: { nodes: LinearIssue[] } } }>(
      `
      ${this.issueFragment}
      query($projectId: String!) {
        project(id: $projectId) {
          issues {
            nodes { ...IssueFields }
          }
        }
      }
    `,
      { projectId }
    );

    return result?.project?.issues?.nodes ?? [];
  }

  /**
   * Get child issues of a parent
   */
  async getChildIssues(parentId: string): Promise<LinearIssue[]> {
    const result = await this.query<{ issue: { children: { nodes: LinearIssue[] } } }>(
      `
      ${this.issueFragment}
      query($parentId: String!) {
        issue(id: $parentId) {
          children {
            nodes { ...IssueFields }
          }
        }
      }
    `,
      { parentId }
    );

    return result?.issue?.children?.nodes ?? [];
  }

  /**
   * Create a new issue
   */
  async createIssue(input: MudkhalKhalqQadiya): Promise<WasfaMutaba> {
    /** Resolve status name to Linear stateId if provided */
    let stateId: string | undefined;
    if (input.status) {
      const resolved = await this.getStateId(input.status);
      if (resolved) stateId = resolved;
    }

    /**
     * Resolve label names to IDs (Linear createIssue takes labelIds)
     * For now, pass labels through — callers who need labelIds should resolve them
     */
    const linearInput: Record<string, unknown> = {
      title: input.title,
      description: input.description,
      estimate: input.estimate,
      parentId: input.parentId,
    };
    if (stateId) linearInput.stateId = stateId;

    const result = await this.query<{
      issueCreate: { success: boolean; issue: LinearIssue };
    }>(
      `
      ${this.issueFragment}
      mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { ...IssueFields }
        }
      }
    `,
      {
        input: {
          teamId: this.teamId,
          ...linearInput,
        },
      }
    );

    if (result?.issueCreate?.success) {
      await logger.akhbar("linear", `Created issue ${result.issueCreate.issue.identifier}`);
      return this.toWasfaMutaba(result.issueCreate.issue);
    }

    throw new Error("Failed to create issue");
  }

  /**
   * Update an issue
   */
  async updateIssue(
    issueId: string,
    input: MudkhalTahdithQadiya
  ): Promise<WasfaMutaba> {
    /** Resolve status name to Linear stateId if provided */
    const linearInput: Record<string, unknown> = {};
    if (input.title !== undefined) linearInput.title = input.title;
    if (input.description !== undefined) linearInput.description = input.description;
    if (input.estimate !== undefined) linearInput.estimate = input.estimate;
    if (input.status) {
      const stateId = await this.getStateId(input.status);
      if (stateId) linearInput.stateId = stateId;
    }

    const result = await this.query<{
      issueUpdate: { success: boolean; issue: LinearIssue };
    }>(
      `
      ${this.issueFragment}
      mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { ...IssueFields }
        }
      }
    `,
      { id: issueId, input: linearInput }
    );

    if (result?.issueUpdate?.success && result.issueUpdate.issue) {
      return this.toWasfaMutaba(result.issueUpdate.issue);
    }

    throw new Error(`Failed to update issue ${issueId}`);
  }

  /**
   * Update issue status by name
   */
  async updateIssueStatus(issueId: string, statusName: string): Promise<boolean> {
    try {
      await this.updateIssue(issueId, { status: statusName });
      return true;
    } catch {
      await logger.sajjalKhata("linear", `Failed to update status to: ${statusName}`);
      return false;
    }
  }

  /**
   * Add a comment to an issue
   */
  async addComment(issueId: string, body: string): Promise<boolean> {
    const result = await this.query<{ commentCreate: { success: boolean } }>(
      `
      mutation($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
        }
      }
    `,
      { input: { issueId, body } }
    );

    return result?.commentCreate?.success ?? false;
  }


  /**
   * Create a relation between two issues
   * 
   * Linear relation types:
   * - "blocks" - issueId blocks relatedIssueId
   * - "duplicate" - issueId is duplicate of relatedIssueId
   * - "related" - general relation
   * 
   * Note: Linear API requires UUIDs, not identifiers. Use getIssue() first to resolve.
   */
  async createRelation(
    issueId: string,
    relatedIssueId: string,
    type: "blocks" | "duplicate" | "related"
  ): Promise<boolean> {
    const result = await this.query<{
      issueRelationCreate: { success: boolean; issueRelation?: { id: string } };
    }>(
      `
      mutation($input: IssueRelationCreateInput!) {
        issueRelationCreate(input: $input) {
          success
          issueRelation { id }
        }
      }
    `,
      {
        input: {
          issueId,
          relatedIssueId,
          type,
        },
      }
    );

    if (result?.issueRelationCreate?.success) {
      await logger.akhbar("linear", `Created ${type} relation: ${issueId} -> ${relatedIssueId}`);
      return true;
    }

    return false;
  }

  /**
   * Delete a relation by its ID
   */
  async deleteRelation(relationId: string): Promise<boolean> {
    const result = await this.query<{ issueRelationDelete: { success: boolean } }>(
      `
      mutation($id: String!) {
        issueRelationDelete(id: $id) {
          success
        }
      }
    `,
      { id: relationId }
    );

    return result?.issueRelationDelete?.success ?? false;
  }

  /**
   * Get all relations for an issue (with relation IDs for deletion)
   */
  async getIssueRelations(issueId: string): Promise<Array<{
    id: string;
    type: string;
    issueId: string;
    issueIdentifier: string;
    relatedIssueId: string;
    relatedIssueIdentifier: string;
  }>> {
    const result = await this.query<{
      issue: {
        relations: {
          nodes: Array<{
            id: string;
            type: string;
            issue: { id: string; identifier: string };
            relatedIssue: { id: string; identifier: string };
          }>;
        };
      };
    }>(
      `
      query($id: String!) {
        issue(id: $id) {
          relations {
            nodes {
              id
              type
              issue { id identifier }
              relatedIssue { id identifier }
            }
          }
        }
      }
    `,
      { id: issueId }
    );

    if (!result?.issue?.relations?.nodes) {
      return [];
    }

    return result.issue.relations.nodes.map((r) => ({
      id: r.id,
      type: r.type,
      issueId: r.issue.id,
      issueIdentifier: r.issue.identifier,
      relatedIssueId: r.relatedIssue.id,
      relatedIssueIdentifier: r.relatedIssue.identifier,
    }));
  }

  /**
   * Set relations for an issue (replaces existing relations of same type)
   * 
   * This is a higher-level method that:
   * 1. Gets current relations
   * 2. Computes diff (what to add, what to remove)
   * 3. Applies changes
   * 
   * @param identifier - Issue identifier (e.g., "TEAM-200-BE")
   * @param blocks - Identifiers of issues this blocks
   * @param blockedBy - Identifiers of issues that block this
   */
  async setRelations(
    identifier: string,
    blocks?: string[],
    blockedBy?: string[]
  ): Promise<void> {
    const errors: string[] = [];
    let added = 0;
    let removed = 0;

    /** Get the issue to resolve UUID */
    const issue = await this.getLinearIssue(identifier);
    if (!issue) {
      throw new Error(`Issue not found: ${identifier}`);
    }

    /** Get current relations */
    const currentRelations = await this.getIssueRelations(issue.id);

    if (blocks !== undefined) {
      const currentBlocks = currentRelations
        .filter((r) => r.type === "blocks" && r.issueIdentifier === identifier)
        .map((r) => ({ id: r.id, targetIdentifier: r.relatedIssueIdentifier }));

      const currentBlockIds = currentBlocks.map((r) => r.targetIdentifier);
      const toAdd = blocks.filter((id) => !currentBlockIds.includes(id));
      const toRemove = currentBlocks.filter((r) => !blocks.includes(r.targetIdentifier));

      for (const rel of toRemove) {
        const deleted = await this.deleteRelation(rel.id);
        if (deleted) {
          removed++;
        } else {
          errors.push(`Failed to remove blocks relation to ${rel.targetIdentifier}`);
        }
      }

      for (const targetIdentifier of toAdd) {
        const targetIssue = await this.getLinearIssue(targetIdentifier);
        if (!targetIssue) {
          errors.push(`Target issue not found: ${targetIdentifier}`);
          continue;
        }
        const created = await this.createRelation(issue.id, targetIssue.id, "blocks");
        if (created) {
          added++;
        } else {
          errors.push(`Failed to create blocks relation to ${targetIdentifier}`);
        }
      }
    }

    if (blockedBy !== undefined) {
      
      const currentBlockedBy = currentRelations
        .filter((r) => r.type === "blocks" && r.relatedIssueIdentifier === identifier)
        .map((r) => ({ id: r.id, blockerIdentifier: r.issueIdentifier }));

      const currentBlockerIds = currentBlockedBy.map((r) => r.blockerIdentifier);
      const toAdd = blockedBy.filter((id) => !currentBlockerIds.includes(id));
      const toRemove = currentBlockedBy.filter((r) => !blockedBy.includes(r.blockerIdentifier));

      for (const rel of toRemove) {
        const deleted = await this.deleteRelation(rel.id);
        if (deleted) {
          removed++;
        } else {
          errors.push(`Failed to remove blocked_by relation from ${rel.blockerIdentifier}`);
        }
      }

      for (const blockerIdentifier of toAdd) {
        const blockerIssue = await this.getLinearIssue(blockerIdentifier);
        if (!blockerIssue) {
          errors.push(`Blocker issue not found: ${blockerIdentifier}`);
          continue;
        }
        /** Create: blocker.blocks(this) */
        const created = await this.createRelation(blockerIssue.id, issue.id, "blocks");
        if (created) {
          added++;
        } else {
          errors.push(`Failed to create blocked_by relation from ${blockerIdentifier}`);
        }
      }
    }

    await logger.akhbar("linear", `Set relations for ${identifier}`, {
      added,
      removed,
      errors,
    });

    if (errors.length > 0) {
      throw new Error(`Relation errors: ${errors.join(", ")}`);
    }
  }


  /**
   * Get project by ID
   */
  async getProject(projectId: string): Promise<MashruMutabi | null> {
    const result = await this.query<{ project: LinearProject }>(
      `
      ${this.issueFragment}
      query($projectId: String!) {
        project(id: $projectId) {
          id
          name
          description
          state
          url
          issues {
            nodes { ...IssueFields }
          }
        }
      }
    `,
      { projectId }
    );

    const p = result?.project;
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? undefined,
      url: p.url,
      issueCount: p.issues?.nodes?.length,
    };
  }

  /**
   * Search projects by name
   */
  async searchProjects(name: string): Promise<MashruMutabi[]> {
    const result = await this.query<{ projects: { nodes: LinearProject[] } }>(
      `
      query($name: String!) {
        projects(filter: { name: { contains: $name } }) {
          nodes {
            id
            name
            description
            state
            url
          }
        }
      }
    `,
      { name }
    );

    return (result?.projects?.nodes ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? undefined,
      url: p.url,
    }));
  }


  /**
   * Get regex pattern matching Linear URLs
   */
  getUrlPattern(): RegExp {
    return /https:\/\/linear\.app\/[^\s]+/;
  }

  /**
   * Parse a Linear URL and extract entity type and ID
   * Supports: /issue/TEAM-123, /project/abc123, etc.
   */
  parseUrl(url: string): RabitWasfaMuhallal | null {
    try {
      const parsed = new URL(url);

      if (!parsed.hostname.includes("linear.app")) {
        return null;
      }

      const pathParts = parsed.pathname.split("/").filter(Boolean);

      /** /issue/TEAM-123 or /TEAM/issue/TEAM-123 */
      const issueIndex = pathParts.indexOf("issue");
      if (issueIndex !== -1 && pathParts[issueIndex + 1]) {
        return { naw: "wasfa" as NawKiyan, id: pathParts[issueIndex + 1] };
      }

      /** /project/uuid */
      const projectIndex = pathParts.indexOf("project");
      if (projectIndex !== -1 && pathParts[projectIndex + 1]) {
        return { naw: "mashru" as NawKiyan, id: pathParts[projectIndex + 1] };
      }

      /** Direct identifier like /TEAM-123 */
      const identifierMatch = pathParts.find((p) => /^[A-Z]+-\d+$/.test(p));
      if (identifierMatch) {
        return { naw: "wasfa" as NawKiyan, id: identifierMatch };
      }

      return { naw: "majhul" as NawKiyan, id: pathParts.join("/") };
    } catch {
      return null;
    }
  }


  /**
   * Search milestones (cycles in Linear terminology)
   */
  async searchMilestones(query: string): Promise<MaalimMutabi[]> {
    const result = await this.query<{
      cycles: {
        nodes: Array<{
          id: string;
          name: string;
          number: number;
          startsAt: string;
          endsAt: string;
        }>;
      };
    }>(
      `
      query($teamKey: String!) {
        cycles(filter: { team: { key: { eq: $teamKey } } }) {
          nodes {
            id
            name
            number
            startsAt
            endsAt
          }
        }
      }
    `,
      { teamKey: this.teamId }
    );

    if (!result?.cycles?.nodes) {
      return [];
    }

    const queryLower = query.toLowerCase();
    return result.cycles.nodes
      .filter((c) => c.name.toLowerCase().includes(queryLower))
      .map((c) => ({
        id: c.id,
        name: c.name,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
      }));
  }

  /**
   * Get the currently active milestone (cycle)
   */
  async getActiveMilestone(): Promise<MaalimMutabi | null> {
    const cycle = await this.getCurrentCycle();
    if (!cycle) return null;
    return {
      id: cycle.id,
      name: cycle.name,
    };
  }


  /**
   * Map a LinearIssue to the normalized WasfaMutaba type
   */
  private toWasfaMutaba(issue: LinearIssue): WasfaMutaba {
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      status: issue.state?.name,
      url: issue.url,
      parentId: issue.parent?.id,
      parent: issue.parent
        ? { identifier: issue.parent.identifier, title: issue.parent.title }
        : undefined,
      labels: issue.labels?.nodes?.map((l) => l.name),
      estimate: issue.estimate ?? undefined,
    };
  }
}

/**
 * Create a Linear client instance
 */
export function createLinearClient(config: TasmimIksir): MutabiWasfa {
  return new LinearClient(config);
}
