package commands

import (
	"fmt"
	"os"

	"github.com/outfitter-dev/trails/internal/session"
	"github.com/outfitter-dev/trails/internal/state"
	"github.com/spf13/cobra"
)

var startAgentCmd = &cobra.Command{
	Use:   "start-agent [session_id]",
	Short: "Start an agent in a session",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		sessionID := args[0]
		ctx := cmd.Context()

		wd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("failed to get working directory: %w", err)
		}

		st, closeState, err := state.Load(wd)
		if err != nil {
			return fmt.Errorf("failed to load state: %w", err)
		}
		defer closeState()

		sess, exists := st.Sessions[sessionID]
		if !exists {
			return fmt.Errorf("session not found: %s", sessionID)
		}

		manager, closeManager, err := session.NewManager(wd)
		if err != nil {
			return fmt.Errorf("failed to create session manager: %w", err)
		}
		defer closeManager()

		if err := manager.StartAgent(ctx, sess); err != nil {
			return fmt.Errorf("failed to start agent: %w", err)
		}

		fmt.Printf("Started %s agent for session: %s\\n", sess.Agent, sess.GetDisplayName())

		return nil
	},
}

func init() {
	rootCmd.AddCommand(startAgentCmd)
}
