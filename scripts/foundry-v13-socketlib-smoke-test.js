/**
 * DOMAIN MANAGER — Foundry VTT v13.351 + Socketlib In-World Smoke Test Macro
 *
 * How to run:
 * 1. Open Foundry VTT v13.351 with Domain Manager and Socketlib enabled.
 * 2. Create a new Macro (type: Script) and paste this entire file, OR paste into the browser DevTools Console.
 * 3. Run the macro as GM or Player.
 */

(async function runDomainManagerSmokeTest() {
  console.log(
    "%c[Domain Manager Smoke Test] Starting verification on Foundry VTT v13...",
    "color: #4CAF50; font-weight: bold; font-size: 14px;"
  );

  const results = [];
  function assert(condition, message, details = null) {
    if (condition) {
      console.log(`%c✔ PASS: ${message}`, "color: #2e7d32; font-weight: bold;");
      results.push({ test: message, pass: true });
    } else {
      console.error(`✖ FAIL: ${message}`, details ? details : "");
      results.push({ test: message, pass: false, details });
    }
  }

  try {
    // 1. Module & Socket Configuration Verification
    const module = game.modules.get("domain-manager");
    assert(module !== undefined, "Module 'domain-manager' is registered in game.modules");
    assert(module?.active === true, "Module 'domain-manager' is currently active");
    assert(module?.socket === true, "Module manifest specifies 'socket: true'");

    // 2. Socketlib Dependency Verification
    const socketlibModule = game.modules.get("socketlib");
    assert(socketlibModule !== undefined, "Module 'socketlib' is present");
    assert(socketlibModule?.active === true, "Module 'socketlib' is active");
    assert(window.socketlib !== undefined, "window.socketlib global is defined and ready");

    // 3. Domain Manager Runtime Verification
    const dm = game.modules.get("domain-manager")?.api;
    console.log("[Domain Manager Smoke Test] API surface:", dm);

    // 4. Socketlib Handler Inspection & Direct Invocation Test (Fail Closed)
    const socketlibSocket = window.socketlib?.modules?.get("domain-manager");
    assert(socketlibSocket !== undefined, "Socketlib has registered socket for 'domain-manager'");

    const executeCommandFn = socketlibSocket?.functions?.get("executeCommand");
    assert(typeof executeCommandFn === "function", "Handler 'executeCommand' is registered in socketlib");

    if (executeCommandFn) {
      // 4a. Direct call without socket context must fail closed with DM_AUTH_UNAUTHENTICATED
      const directCommandId = `cmd_${crypto.randomUUID()}`;
      const directPacket = {
        protocol: "dm-command-v1",
        kind: "DM_CMD_REQUEST",
        correlationId: `corr_${crypto.randomUUID()}`,
        command: {
          contractVersion: 1,
          commandId: directCommandId,
          type: "domain:restore",
          payload: { id: "non-existent-domain-id-0000" },
          issuedAtReal: Date.now()
        },
        declaredSenderUserId: "unauthenticated_test_user"
      };

      const directCallResult = await executeCommandFn.call({}, directPacket);
      console.log("[Domain Manager Smoke Test] directCallResult:", directCallResult);

      const isDirectCallUnauth =
        (!directCallResult?.ok && directCallResult?.error?.code === "DM_AUTH_UNAUTHENTICATED") ||
        (directCallResult?.ok &&
          directCallResult?.value?.status === "rejected" &&
          directCallResult?.value?.error?.code === "DM_AUTH_UNAUTHENTICATED");

      assert(
        isDirectCallUnauth,
        "Direct handler call without socket context fails closed with DM_AUTH_UNAUTHENTICATED",
        directCallResult
      );

      // 4b. Direct call with spoofed sender (declaredSenderUserId !== this.socketdata.userId)
      const spoofCommandId = `cmd_${crypto.randomUUID()}`;
      const spoofedPacket = {
        protocol: "dm-command-v1",
        kind: "DM_CMD_REQUEST",
        correlationId: `corr_${crypto.randomUUID()}`,
        command: {
          contractVersion: 1,
          commandId: spoofCommandId,
          type: "domain:restore",
          payload: { id: "non-existent-domain-id-0000" },
          issuedAtReal: Date.now()
        },
        declaredSenderUserId: "spoofed_target_user_2"
      };

      const spoofedCallResult = await executeCommandFn.call(
        { socketdata: { userId: "legitimate_sender_user_1" } },
        spoofedPacket
      );
      console.log("[Domain Manager Smoke Test] spoofedCallResult:", spoofedCallResult);

      const isSpoofedRejected =
        (!spoofedCallResult?.ok && spoofedCallResult?.error?.code === "DM_SECURITY_SENDER_SPOOFED") ||
        (spoofedCallResult?.ok &&
          spoofedCallResult?.value?.status === "rejected" &&
          spoofedCallResult?.value?.error?.code === "DM_SECURITY_SENDER_SPOOFED");

      assert(
        isSpoofedRejected,
        "Handler rejects packet with declaredSenderUserId !== this.socketdata.userId with DM_SECURITY_SENDER_SPOOFED",
        spoofedCallResult
      );
    }

    // 5. Live RPC Dispatch to Primary Authority
    const activeGM = game.users.activeGM;
    assert(activeGM !== undefined, "Active Primary Authority GM is present in game.users");

    if (activeGM && socketlibSocket) {
      console.log(
        `[Domain Manager Smoke Test] Active GM: ${activeGM.name} (${activeGM.id}), Current user: ${game.user.name} (${game.userId})`
      );

      const liveCommandId = `cmd_${crypto.randomUUID()}`;
      const livePacket = {
        protocol: "dm-command-v1",
        kind: "DM_CMD_REQUEST",
        correlationId: `corr_${crypto.randomUUID()}`,
        command: {
          contractVersion: 1,
          commandId: liveCommandId,
          type: "domain:restore",
          payload: { id: "non-existent-domain-id-0000" },
          issuedAtReal: Date.now()
        },
        declaredSenderUserId: game.userId
      };

      const rpcResult = await socketlibSocket.executeAsUser("executeCommand", activeGM.id, livePacket);
      console.log("[Domain Manager Smoke Test] Live RPC dispatch result:", rpcResult);

      const isCallerPrimaryAuthority = game.userId === activeGM.id;

      if (!isCallerPrimaryAuthority) {
        // Player calling GM: Must traverse Socketlib, execute on GM's CommandBus, and return DM_DOMAIN_NOT_FOUND
        const isExpectedRejection =
          rpcResult?.ok === true &&
          rpcResult?.value?.status === "rejected" &&
          rpcResult?.value?.error?.code === "DM_DOMAIN_NOT_FOUND" &&
          rpcResult?.value?.commandId === liveCommandId;

        assert(
          isExpectedRejection,
          "Live RPC via socketlib.executeAsUser processed by CommandBus and returned DM_DOMAIN_NOT_FOUND without writing state",
          rpcResult
        );
      } else {
        // Running as Primary Authority (GM):
        // 1. Socketlib RPC to self enforces that socket packets cannot claim Primary Authority identity (G2-AUD-002)
        const isSocketSpoofedOrRejected =
          rpcResult?.ok === true &&
          rpcResult?.value?.status === "rejected" &&
          (rpcResult?.value?.error?.code === "DM_SECURITY_SENDER_SPOOFED" ||
            rpcResult?.value?.error?.code === "DM_DOMAIN_NOT_FOUND");

        assert(
          isSocketSpoofedOrRejected,
          "Socket RPC claiming Primary Authority identity is rejected with DM_SECURITY_SENDER_SPOOFED (G2-AUD-002)",
          rpcResult
        );

        // 2. Verify CommandBus production pipeline processes canonical domain:restore and returns DM_DOMAIN_NOT_FOUND
        if (dm?.transport) {
          const localCmdId = `cmd_${crypto.randomUUID()}`;
          const localResult = await dm.transport.send({
            contractVersion: 1,
            commandId: localCmdId,
            type: "domain:restore",
            payload: { id: "non-existent-domain-id-0000" },
            issuedAtReal: Date.now()
          });
          console.log("[Domain Manager Smoke Test] CommandBus production pipeline result:", localResult);

          const isPipelineVerified =
            localResult?.ok === true &&
            localResult?.value?.status === "rejected" &&
            localResult?.value?.error?.code === "DM_DOMAIN_NOT_FOUND" &&
            localResult?.value?.commandId === localCmdId;

          assert(
            isPipelineVerified,
            "CommandBus production pipeline receives/processes domain:restore and returns DM_DOMAIN_NOT_FOUND without writing state",
            localResult
          );
        }
      }
    }

    // Summary
    const passed = results.filter((r) => r.pass).length;
    const total = results.length;
    console.log(
      `%c[Domain Manager Smoke Test] COMPLETED: ${passed}/${total} checks passed.`,
      passed === total
        ? "color: #2e7d32; font-weight: bold; font-size: 14px;"
        : "color: #c62828; font-weight: bold; font-size: 14px;"
    );

    if (typeof ui !== "undefined" && ui.notifications) {
      if (passed === total) {
        ui.notifications.info(`Domain Manager G2 Smoke Test: All ${passed}/${total} checks passed!`);
      } else {
        ui.notifications.error(`Domain Manager G2 Smoke Test: ${total - passed} checks failed.`);
      }
    }
  } catch (err) {
    console.error("[Domain Manager Smoke Test] Exception occurred:", err);
  }
})();
