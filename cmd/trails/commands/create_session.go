package commands

import (
	"fmt"
	"os"

	"github.com/outfitter-dev/trails/internal/config"
	"github.com/outfitter-dev/trails/internal/session"
	"github.com/outfitter-dev/trails/internal/state"
	"github.com/spf13/cobra"
)

var createSessionCmd = &cobra.Command{
	Use:   "create-session",
	Short: "Create a new session",
	RunE: func(cmd *cobra.Command, args []string) error {
		name, _ := cmd.Flags().GetString("name")
		agent, _ := cmd.Flags().GetString("agent")

		ctx := cmd.Context()

		wd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("failed to get working directory: %w", err)
		}

		cfg, err := config.Load(wd)
		if err != nil {
			return fmt.Errorf("failed to load config: %w", err)
		}

		st, closeState, err := state.Load(wd)
		if err != nil {
			return fmt.Errorf("failed to load state: %w", err)
		}
		defer closeState()

		if agent == "" {
			agent = cfg.GetDefaultAgent()
		}

		manager, closeManager, err := session.NewManager(wd)
		if err != nil {
			return fmt.Errorf("failed to create session manager: %w", err)
		}
		defer closeManager()

		sess, err := manager.CreateSession(ctx, name, agent)
		if err != nil {
			return fmt.Errorf("failed to create session: %w", err)
		}

		st.AddSession(sess)
		
		fmt.Printf("Created session: %s (ID: %s)\\n", sess.GetDisplayName(), sess.ID)
		fmt.Printf("Environment: %s\\n", sess.EnvironmentID.String())

		return nil
	},
}

func init() {
	rootCmd.AddCommand(createSessionCmd)
	createSessionCmd.Flags().String("name", "session", "Session name")
	createSessionCmd.Flags().String("agent", "", "Agent type")
} 