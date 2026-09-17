/**
 * DOMAIN MANAGER — Foundry VTT v13.351 + Socketlib In-World Smoke Test Macro
 *
 * How to run:
 * 1. Open Foundry VTT v13.351 with Domain Manager and Socketlib enabled.
 * 2. Create a new Macro (type: Script) and paste this entire file, OR paste into the browser DevTools Console.
 * 3. Run the macro as GM or Player.
 */

(async function runDomainManagerSmokeTest() {
  console.log("%c[Domain Manager Smoke Test] Starting verification on Foundry VTT v13...", "color: #4CAF50; font-weight: bold; font-size: 14px;");

  const results = [];
  function assert(condition, message) {
    if (condition) {
      console.log(`%c✔ PASS: ${message}`, "color: #2e7d32; font-weight: bold;");
      results.push({ test: message, pass: true });
    } else {
      console.error(`✖ FAIL: ${message}`);
      results.push({ test: message, pass: false });
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
      // Direct call without socket context must fail closed
      const directCallResult = await executeCommandFn.call({}, {
        protocol: "dm-command-v1",
        kind: "DM_CMD_REQUEST",
        correlationId: "smoke_direct_call",
        command: {
          contractVersion: "1.0.0",
          commandId: "cmd_smoke_direct",
          type: "domain:ping",
          payload: {},
          issuedAtReal: Date.now()
        },
        declaredSenderUserId: game.userId
      });

      assert(
        directCallResult?.value?.status === "rejected" && directCallResult?.value?.error?.code === "DM_AUTH_UNAUTHENTICATED",
        "Direct handler call without socket context fails closed with DM_AUTH_UNAUTHENTICATED"
      );

      // Direct call with spoofed sender in packet
      const spoofedCallResult = await executeCommandFn.call({ socketdata: { userId: game.userId } }, {
        protocol: "dm-command-v1",
        kind: "DM_CMD_REQUEST",
        correlationId: "smoke_spoof_call",
        command: {
          contractVersion: "1.0.0",
          commandId: "cmd_smoke_spoof",
          type: "domain:ping",
          payload: {},
          issuedAtReal: Date.now()
        },
        declaredSenderUserId: "fake-user-999" // Divergent from socketdata.userId
      });

      assert(
        spoofedCallResult?.value?.status === "rejected" && spoofedCallResult?.value?.error?.code === "DM_SECURITY_SENDER_SPOOFED",
        "Handler rejects packet with declaredSenderUserId !== this.socketdata.userId with DM_SECURITY_SENDER_SPOOFED"
      );
    }

    // 5. Live RPC Dispatch (if active GM is connected)
    const activeGM = game.users.activeGM;
    if (activeGM) {
      console.log(`[Domain Manager Smoke Test] Active GM found: ${activeGM.name} (${activeGM.id})`);
      
      const pingPacket = {
        protocol: "dm-command-v1",
        kind: "DM_CMD_REQUEST",
        correlationId: `smoke_rpc_${Date.now()}`,
        command: {
          contractVersion: "1.0.0",
          commandId: `cmd_smoke_rpc_${Date.now()}`,
          type: "domain:ping",
          payload: { timestamp: Date.now() },
          issuedAtReal: Date.now()
        },
        declaredSenderUserId: game.userId
      };

      const rpcResult = await socketlibSocket.executeAsUser("executeCommand", activeGM.id, pingPacket);
      console.log("[Domain Manager Smoke Test] RPC dispatch result:", rpcResult);
      assert(rpcResult !== undefined, "Live RPC via socketlib.executeAsUser returned response");
    } else {
      console.warn("[Domain Manager Smoke Test] No active GM connected; live RPC dispatch skipped.");
    }

    // Summary
    const passed = results.filter((r) => r.pass).length;
    const total = results.length;
    console.log(
      `%c[Domain Manager Smoke Test] COMPLETED: ${passed}/${total} checks passed.`,
      passed === total ? "color: #2e7d32; font-weight: bold; font-size: 14px;" : "color: #c62828; font-weight: bold; font-size: 14px;"
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
