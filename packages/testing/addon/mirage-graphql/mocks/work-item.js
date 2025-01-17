import { DateTime } from "luxon";

import deserialize from "@projectcaluma/ember-testing/mirage-graphql/deserialize";
import BaseMock from "@projectcaluma/ember-testing/mirage-graphql/mocks/base";
import register from "@projectcaluma/ember-testing/mirage-graphql/register";
import { createInquiry } from "@projectcaluma/ember-testing/scenarios/distribution";

export default class WorkItemMock extends BaseMock {
  @register("ResumeWorkItemPayload")
  handleResumeWorkItem(_, { input }) {
    return this.handleSavePayload.fn.call(this, _, {
      input: { id: input.id, status: "READY" },
    });
  }

  @register("SuspendWorkItemPayload")
  handleSuspendWorkItem(_, { input }) {
    return this.handleSavePayload.fn.call(this, _, {
      input: { id: input.id, status: "SUSPENDED" },
    });
  }

  @register("CancelWorkItemPayload")
  handleCancelWorkItem(_, { input }) {
    return this.handleSavePayload.fn.call(this, _, {
      input: { id: input.id, status: "CANCELED" },
    });
  }

  @register("RedoWorkItemPayload")
  handleRedoWorkItem(_, { input }) {
    const { id } = deserialize(input);
    const workItem = this.collection.find(id);
    const caseId = workItem?.childCaseId;

    if (workItem.taskId === "distribution") {
      this.collection
        .where({ caseId, taskId: "complete-distribution" })
        .update({ status: "READY" });
      this.collection
        .where({ caseId, taskId: "create-inquiry" })
        .update({ status: "READY" });
    } else if (workItem.taskId === "inquiry") {
      this.server.create("work-item", {
        caseId,
        status: "READY",
        taskId: "adjust-inquiry-answer",
      });
    }

    return this.handleSavePayload.fn.call(this, _, {
      input: { id, isRedoable: false, status: "READY" },
    });
  }

  @register("CompleteWorkItemPayload")
  handleCompleteWorkItem(_, { input }) {
    const { id } = deserialize(input);

    const workItem = this.collection.find(id);

    const taskId = workItem.taskId;
    const caseId = workItem.caseId;

    /**
     * Disclaimer: this is a static configuration of a pre-configured workflow
     * in the distribution scenario and should most likely be handled properly
     * like the backend does. However, this small requirement does not justify a
     * complex implementation of backend logic which is why we keep this static
     * for now.
     */
    if (["adjust-inquiry-answer", "compose-inquiry-answer"].includes(taskId)) {
      this.server.create("work-item", {
        caseId,
        status: "READY",
        taskId: "confirm-inquiry-answer",
      });
      this.server.create("work-item", {
        caseId,
        status: "READY",
        taskId: "revise-inquiry-answer",
      });
    } else if (taskId === "confirm-inquiry-answer") {
      this.collection
        .findBy({ caseId, taskId: "revise-inquiry-answer" })
        .update({ status: "CANCELED" });
      this.collection
        .findBy({ childCaseId: caseId })
        .update({ status: "COMPLETED", isRedoable: true });
      this.schema.cases.find(caseId).update({ status: "COMPLETED" });
    } else if (taskId === "revise-inquiry-answer") {
      this.collection
        .findBy({ caseId, taskId: "confirm-inquiry-answer" })
        .update({ status: "CANCELED" });
      this.server.create("work-item", {
        caseId,
        status: "READY",
        taskId: "adjust-inquiry-answer",
      });
    } else if (taskId === "create-inquiry") {
      const { addressed_groups: groups, answers } = JSON.parse(input.context);

      const remark = answers?.["inquiry-remark"] ?? "";
      const deadline =
        answers?.["inquiry-deadline"] ??
        DateTime.now().plus({ days: 30 }).toISODate();

      groups.forEach((group) => {
        createInquiry(
          this.server,
          workItem.case,
          {
            to: { id: group },
            from: { id: workItem.addressedGroups[0] },
            remark,
            deadline,
          },
          {
            createdAt: new Date(),
          }
        );

        this.server.create("work-item", {
          taskId: "create-inquiry",
          status: "READY",
          addressedGroups: [group],
        });
      });

      this.server.create("work-item", {
        taskId: "create-inquiry",
        status: "READY",
        addressedGroups: workItem.addressedGroups,
      });
    } else if (taskId === "complete-distribution") {
      this.collection
        .where({ childCaseId: caseId, status: "READY", taskId: "distribution" })
        .update({ status: "COMPLETED", isRedoable: true });

      this.collection
        .where({ caseId, status: "READY", taskId: "inquiry" })
        .update({ status: "SKIPPED" });

      this.collection
        .where({ caseId, status: "READY" })
        .update({ status: "CANCELED" });

      this.collection
        .where({ caseId, status: "SUSPENDED" })
        .update({ status: "CANCELED" });
    }

    return this.handleSavePayload.fn.call(this, _, {
      input: { id, status: "COMPLETED" },
    });
  }
}
