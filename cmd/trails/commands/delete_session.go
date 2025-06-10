package commands

import (
	"fmt"
	"os"

	"github.com/outfitter-dev/trails/internal/session"
	"github.com/outfitter-dev/trails/internal/state"
	"github.com/spf13/cobra"
)

var deleteSessionCmd = &cobra.Command{
	Use:   "delete-session [session_id]",
	Short: "Delete a session",
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

		if err := manager.DestroySession(ctx, sess); err != nil {
			return fmt.Errorf("failed to destroy session: %w", err)
		}

		st.RemoveSession(sessionID)
		
		fmt.Printf("Deleted session: %s\\n", sess.GetDisplayName())

		return nil
	},
}

func init() {
	rootCmd.AddCommand(deleteSessionCmd)
} 